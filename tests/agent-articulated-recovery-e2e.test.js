import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';
import { NavigationSystem } from '../src/runtime/systems/NavigationSystem.js';
import { LocomotionSystem } from '../src/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';
import { PolicyEngine } from '../src/policy/PolicyEngine.js';
import { TraceRecorder } from '../src/observability/TraceRecorder.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { registerCoreSkills } from '../src/skills/registerCoreSkills.js';
import { AgentTools } from '../src/agent/AgentTools.js';
import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const floorMesh=()=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(14,.2,12));mesh.position.y=-.1;mesh.updateMatrixWorld(true);return mesh;};
const cabinetObject=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};

async function setup({blockerAction='open',blockerTarget=-1.35}={}){
  const store=new ObjectStore(),scene=new THREE.Scene(),ground=floorMesh(); scene.add(ground);
  const physics=new PhysicsSystem(); await physics.init();
  physics.addEnvironment([{shape:'box',halfExtents:[7,.1,6],translation:[0,-.1,0]}],{id:'articulated-recovery-floor'});
  const add=(id,assetId,object,manifest,position,{yaw=0,state={}}={})=>{
    object.position.fromArray(position); object.rotation.y=yaw; scene.add(object); object.updateMatrixWorld(true);
    store.add(id,{id,assetId,object,manifest:structuredClone(manifest),state:structuredClone(state)});
    physics.attach(id,store.get(id).manifest,object);
  };
  add('agent_01','agent',new THREE.Group(),assetManifests.agent,[2.5,0,4]);
  add('cabinet_A','cabinet',cabinetObject(),assetManifests.cabinet,[0,0,0],{state:{parts:{door:'close'}}});
  const blockerManifest=structuredClone(assetManifests.cabinet);
  if (blockerAction==='ajar') {
    blockerManifest.parts.door.actions=[...new Set([...blockerManifest.parts.door.actions,'ajar'])];
    blockerManifest.parts.door.targets.ajar=blockerTarget;
  }
  add('cabinet_B','cabinet',cabinetObject(),blockerManifest,[-2.2,0,1],{yaw:Math.PI/2,state:{parts:{door:'close'}}});
  for(let i=0;i<30;i++) physics.step(1/60,store);

  expect(physics.setArticulationTarget('cabinet_B','door',blockerTarget)).toBe(true);
  for(let i=0;i<260;i++) physics.step(1/60,store);
  const initial=physics.articulationState('cabinet_B','door',{target:blockerTarget});
  expect(initial.error).toBeLessThan(.08);
  store.get('cabinet_B').state.parts.door=blockerAction;

  const events=new EventBus();
  const spatial=new SpatialSystem({store,scene});
  const navigation=new NavigationSystem({store,physics,environmentRoots:[ground],events});
  const locomotion=new LocomotionSystem({store,physics,navigation,events});
  const interactions=new InteractionSystem({store,physics,spatial,navigation,locomotion,events});
  const policy=new PolicyEngine();
  const trace=new TraceRecorder({events});
  const mutate=vi.fn(async(_label,fn)=>fn());
  const runtime={
    store,scene,physics,spatial,navigation,locomotion,interactions,events,policy,trace,mutate,
    listObjects:()=>store.list().map(([id,record])=>({id,asset:record.assetId,position:physics.getPosition(id)||record.object.position.toArray(),actions:record.manifest.actions}))
  };
  runtime.skills=registerCoreSkills(new SkillRegistry({policy,trace,runtime}),runtime);
  const tools=new AgentTools(runtime,{profile:'builder',actor:'agent_01'});
  const current=await navigation.ensureCurrent();
  expect(current.success).toBe(true);
  return {runtime,store,physics,spatial,navigation,locomotion,interactions,trace,mutate,tools};
}

async function driveAgent(promise,ctx,max=9000){
  let done=false,result,error;
  promise.then((value)=>{done=true;result=value},(reason)=>{done=true;error=reason});
  for(let i=0;i<max&&!done;i++){
    ctx.locomotion.update(1/60);
    ctx.physics.step(1/60,ctx.store);
    ctx.interactions.update(1/60,new THREE.PerspectiveCamera());
    if(i%12===0) await new Promise((resolve)=>setTimeout(resolve,0)); else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error('articulated recovery agent did not settle');
  return result;
}

describe('verified articulated blocker recovery',()=>{
  it('closes a verified blocking Door through the auxiliary recovery wrapper, then retries and verifies the original Door open',async()=>{
    const ctx=await setup();
    let round=0;
    const requests=[];
    const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      round++;
      if(round===1) return {message:'',toolCalls:[{id:'open-A',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
      if(round===2) return {message:'',toolCalls:[{id:'suggest',name:'suggestRecoveryActions',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door'}}]};
      if(round===3) return {message:'',toolCalls:[{id:'recover-B',name:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'}}]};
      if(round===4) return {message:'',toolCalls:[{id:'retry-A',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
      return {message:'articulated blocker recovered and original open verified',toolCalls:[]};
    })};
    const agent=new ToolCallingAgent({tools:ctx.tools,gateway,maxSteps:7});
    const result=await driveAgent(agent.run('打开 cabinet_A；若另一可执行 articulated Part 正在阻挡，安全改变 blocker 后重试原动作。'),ctx);

    expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
    expect(result.execution.filter((entry)=>entry.executed).map((entry)=>[entry.tool,entry.outcome.state,entry.auxiliary])).toEqual([
      ['approachAndInteract','failed',false],
      ['suggestRecoveryActions','accepted',false],
      ['recoverArticulatedBlocker','verified',true],
      ['approachAndInteract','verified',false]
    ]);

    const firstOpen=JSON.parse(requests[1].messages.find((message)=>message.role==='tool'&&message.name==='approachAndInteract').content);
    expect(firstOpen).toMatchObject({
      status:'action-failed',reason:'STALL',partName:'door',
      attribution:{status:'contact-evidence',blockerCandidates:[expect.objectContaining({kind:'object',objectId:'cabinet_B',partName:'door'})]}
    });
    const suggestion=JSON.parse(requests[2].messages.find((message)=>message.role==='tool'&&message.name==='suggestRecoveryActions').content);
    expect(suggestion).toMatchObject({
      status:'recovery-proposed',ranking:{strategy:'eligible-recovery-route-cost-v2',causal:false},
      recommended:{tool:'recoverArticulatedBlocker',blocker:{objectId:'cabinet_B',partName:'door'},args:{blockerAction:'close'}},
      proposals:[expect.objectContaining({
        recovery:'articulated-blocker',candidateType:'articulated-part',eligible:true,blockerAction:'close',
        blockerState:expect.objectContaining({partName:'door',verifiedAction:'open',requestedAction:null}),
        preflight:expect.objectContaining({actionSweep:{checked:true,clear:true,partName:'door'}}),
        worldCounterfactual:expect.objectContaining({checked:true,geometry:'rapier-world-shape-query',targetIntroducesNoCollision:true,actionIntroducesNoCollision:true}),
        verification:expect.objectContaining({required:'retry-original-post-condition'})
      })]
    });
    const recovered=JSON.parse(requests[3].messages.find((message)=>message.role==='tool'&&message.name==='recoverArticulatedBlocker').content);
    expect(recovered).toMatchObject({
      status:'action-completed',targetId:'cabinet_B',action:'close',targetReached:true,settled:true,
      recovery:{kind:'articulated-blocker',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'},retryOriginal:true
    });
    expect(requests[3].context.task.unresolvedMutations).toHaveLength(1);
    expect(requests[3].context.task.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
    const retried=JSON.parse(requests[4].messages.filter((message)=>message.role==='tool'&&message.name==='approachAndInteract').at(-1).content);
    expect(retried).toMatchObject({status:'action-completed',targetId:'cabinet_A',action:'open',targetReached:true,settled:true});
    expect(retried.arrivalCorrection).toMatchObject({status:'arrived',id:'agent_01'});
    expect(ctx.store.get('cabinet_B').state.parts.door).toBe('close');
    expect(ctx.store.get('cabinet_A').state.parts.door).toBe('open');
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndInteract','skill:recoverArticulatedBlocker','skill:approachAndInteract'
    ]);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },50000);

  it('uses real target-pose counterfactual evidence to choose close over open from an ajar blocking Door, then verifies the original retry',async()=>{
    const ctx=await setup({blockerAction:'ajar',blockerTarget:-.8});
    let round=0;
    const requests=[];
    const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      round++;
      if(round===1) return {message:'',toolCalls:[{id:'open-A',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
      if(round===2) return {message:'',toolCalls:[{id:'suggest',name:'suggestRecoveryActions',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door'}}]};
      if(round===3) return {message:'',toolCalls:[{id:'recover-B',name:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'}}]};
      if(round===4) return {message:'',toolCalls:[{id:'retry-A',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
      return {message:'counterfactual articulated recovery verified',toolCalls:[]};
    })};
    const agent=new ToolCallingAgent({tools:ctx.tools,gateway,maxSteps:7});
    const result=await driveAgent(agent.run('打开 cabinet_A；如果 cabinet_B 的 articulated blocker 有多个候选动作，只按 Runtime counterfactual evidence 选择后重试原动作。'),ctx);

    expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
    const firstOpen=JSON.parse(requests[1].messages.find((message)=>message.role==='tool'&&message.name==='approachAndInteract').content);
    expect(firstOpen).toMatchObject({
      status:'action-failed',reason:'STALL',
      attribution:{status:'contact-evidence',blockerCandidates:[expect.objectContaining({objectId:'cabinet_B',partName:'door'})]}
    });
    const suggestion=JSON.parse(requests[2].messages.find((message)=>message.role==='tool'&&message.name==='suggestRecoveryActions').content);
    expect(suggestion).toMatchObject({
      status:'recovery-proposed',
      recommended:{tool:'recoverArticulatedBlocker',args:{blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'}},
      proposals:[expect.objectContaining({
        blockerAction:'close',
        blockerState:expect.objectContaining({verifiedAction:'ajar',requestedAction:null}),
        actionRanking:expect.objectContaining({
          strategy:'articulated-rapier-shape-counterfactual-v2',basis:'rapier-shape-pairs',causal:false,current:expect.objectContaining({action:'ajar'}),
          convergence:expect.objectContaining({status:'stable',causal:false,qualitative:{targetSweepClear:true,clearanceGain:true},samples:{base:expect.objectContaining({mode:'adaptive'}),dense:expect.objectContaining({mode:'fixed-pair'})}})
        })
      })]
    });
    const ranking=suggestion.proposals[0].actionRanking;
    const open=ranking.actions.find((item)=>item.action==='open');
    const close=ranking.actions.find((item)=>item.action==='close');
    expect(ranking.current.conflictSamples).toBeGreaterThan(0);
    expect(open).toMatchObject({executable:true,rank:2,physicsCounterfactual:expect.objectContaining({checked:true,geometry:'rapier-shape-pairs',samples:expect.objectContaining({mode:'adaptive'}),targetSweepClear:false})});
    expect(close).toMatchObject({executable:true,rank:1,physicsCounterfactual:expect.objectContaining({checked:true,geometry:'rapier-shape-pairs',samples:expect.objectContaining({mode:'adaptive'}),targetSweepClear:true,target:expect.objectContaining({conflictSamples:0})})});
    expect(open.physicsCounterfactual.samples.original).toBe(close.physicsCounterfactual.samples.original);
    expect(close.physicsCounterfactual.samples.blocker).toBeGreaterThan(open.physicsCounterfactual.samples.blocker);
    expect(close.physicsCounterfactual.conflictReduction).toBeGreaterThan(open.physicsCounterfactual.conflictReduction);

    const recovered=JSON.parse(requests[3].messages.find((message)=>message.role==='tool'&&message.name==='recoverArticulatedBlocker').content);
    expect(recovered).toMatchObject({
      status:'action-completed',targetId:'cabinet_B',action:'close',targetReached:true,settled:true,retryOriginal:true,
      counterfactualCalibration:{
        status:'observed',scope:'post-recovery-current-contact',causal:false,
        prediction:{strategy:'articulated-rapier-shape-counterfactual-v2',basis:'rapier-shape-pairs',targetSweepClear:true,targetConflictSamples:0,samples:expect.objectContaining({mode:'adaptive'})},
        observed:{blockerActionVerified:true,currentContactStillPresent:false},
        consistency:'consistent',originalRetryRequired:true
      }
    });
    expect(requests[3].context.task.unresolvedMutations).toHaveLength(1);
    const retried=JSON.parse(requests[4].messages.filter((message)=>message.role==='tool'&&message.name==='approachAndInteract').at(-1).content);
    expect(retried).toMatchObject({status:'action-completed',targetId:'cabinet_A',action:'open',targetReached:true,settled:true});
    expect(ctx.store.get('cabinet_B').state.parts.door).toBe('close');
    expect(ctx.store.get('cabinet_A').state.parts.door).toBe('open');
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndInteract','skill:recoverArticulatedBlocker','skill:approachAndInteract'
    ]);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },50000);

});

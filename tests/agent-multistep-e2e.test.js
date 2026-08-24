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
import { LocalPlannerGateway } from '../src/agent/gateway/LocalPlannerGateway.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const floorMesh=()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(14,.2,10));m.position.y=-.1;m.updateMatrixWorld(true);return m;};
const cupVisual=()=>{const g=new THREE.Group();const m=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.32,16));m.position.y=.16;g.add(m);return g;};
const tableVisual=()=>{const g=new THREE.Group();const top=new THREE.Mesh(new THREE.BoxGeometry(2.4,.16,1.25));top.position.y=1;g.add(top);g.updateMatrixWorld(true);return g;};
const cabinetVisual=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};

async function setup({blockedDoor=false}={}){
  const store=new ObjectStore(),scene=new THREE.Scene(),ground=floorMesh(); scene.add(ground);
  const physics=new PhysicsSystem(); await physics.init();
  const env=[{shape:'box',halfExtents:[7,.1,5],translation:[0,-.1,0]}];
  if(blockedDoor) env.push({shape:'box',halfExtents:[.18,1,.18],translation:[-3.14,1,1.08]});
  physics.addEnvironment(env,{id:blockedDoor?'sequence-stall-environment':'sequence-environment'});

  const add=(id,assetId,object,position,state={})=>{
    object.position.fromArray(position); scene.add(object); object.updateMatrixWorld(true);
    const manifest=structuredClone(assetManifests[assetId]);
    store.add(id,{id,assetId,object,manifest,state:structuredClone(state)}); physics.attach(id,manifest,object);
  };
  add('agent_01','agent',new THREE.Group(),[0,0,4]);
  add('cabinet_01','cabinet',cabinetVisual(),[-2.5,0,0],{parts:{door:'close'}});
  add('cup_01','cup',cupVisual(),[0,0,0]);
  add('table_01','table',tableVisual(),[2.6,0,0]);
  for(let i=0;i<12;i++) physics.step(1/60,store);

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
    listObjects:()=>store.list().map(([id,record])=>({id,asset:record.assetId,position:physics.getPosition(id) || record.object.position.toArray(),actions:record.manifest.actions}))
  };
  runtime.skills=registerCoreSkills(new SkillRegistry({policy,trace,runtime}),runtime);
  const tools=new AgentTools(runtime,{profile:'builder',actor:'agent_01'});
  const agent=new ToolCallingAgent({tools,gateway:null,fallbackGateway:new LocalPlannerGateway(),maxSteps:8});
  return {runtime,store,physics,spatial,navigation,locomotion,interactions,trace,mutate,tools,agent};
}

async function driveAgent(promise,ctx,max=6000){
  let done=false,result,error;
  promise.then(v=>{done=true;result=v},e=>{done=true;error=e});
  for(let i=0;i<max&&!done;i++){
    ctx.locomotion.update(1/60);
    ctx.physics.step(1/60,ctx.store);
    ctx.interactions.update(1/60,new THREE.PerspectiveCamera());
    if(i%12===0) await new Promise(r=>setTimeout(r,0)); else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error('multi-step agent did not settle');
  return result;
}

describe('verified multi-step embodied sequencing',()=>{
  it('executes the exact quick-task prompt as pickup then verified place',async()=>{
    const ctx=await setup();
    const result=await driveAgent(ctx.agent.run('让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定'),ctx);
    expect(result).toMatchObject({
      taskStatus:'completed',
      lastMutation:{tool:'approachAndPlace',outcome:{state:'verified',status:'placed'}},
      unresolvedMutations:[]
    });
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndPickup','skill:approachAndPlace'
    ]);
    expect(ctx.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'}).on).toBe(true);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },45000);

  it('opens, replans, picks up, replans, and places using real Runtime post-conditions',async()=>{
    const ctx=await setup();
    const result=await driveAgent(ctx.agent.run('打开柜门，然后拿起杯子，再把杯子放到桌上。'),ctx);
    expect(result).toMatchObject({
      taskStatus:'completed',
      lastMutation:{tool:'approachAndPlace',outcome:{state:'verified',status:'placed'}},
      unresolvedMutations:[]
    });
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('open');
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    expect(ctx.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'}).on).toBe(true);
    expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'empty'});
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndInteract','skill:approachAndPickup','skill:approachAndPlace'
    ]);
    const sequence=ctx.trace.list({type:'agent.sequence'}).map((entry)=>entry.payload);
    expect(sequence.filter((entry)=>entry.executed===true).map((entry)=>[entry.tool,entry.outcome.state])).toEqual([
      ['approachAndInteract','verified'],['approachAndPickup','verified'],['approachAndPlace','verified']
    ]);
    expect(sequence.filter((entry)=>entry.executed===false)).toHaveLength(0);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },45000);

  it('releases and reacquires a carried Cup when the requested door step comes after pickup',async()=>{
    const ctx=await setup();
    const result=await driveAgent(ctx.agent.run('先拿起 cup_01，再打开 cabinet_01，最后把杯子放到 table_01 上。'),ctx,12000);
    expect(result).toMatchObject({taskStatus:'completed',lastMutation:{tool:'approachAndPlace',outcome:{state:'verified',status:'placed'}},unresolvedMutations:[]});
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('open');
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    expect(ctx.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'}).on).toBe(true);
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndPickup','skill:dropHeld','skill:approachAndInteract','skill:approachAndPickup','skill:approachAndPlace'
    ]);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },60000);

  it('stops after a real door STALL and never executes pickup/place',async()=>{
    const ctx=await setup({blockedDoor:true});
    const result=await driveAgent(ctx.agent.run('打开柜门，然后拿起杯子，再把杯子放到桌上。'),ctx);
    expect(result).toMatchObject({
      taskStatus:'incomplete',
      lastMutation:{tool:'approachAndInteract',outcome:{state:'failed',status:'action-failed',reason:'STALL'}}
    });
    expect(result.unresolvedMutations).toHaveLength(1);
    expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',status:'action-failed',reason:'STALL'}});
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('close');
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'empty'});
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual(['skill:approachAndInteract']);
    const outcomes=ctx.trace.list({type:'agent.sequence'}).map((entry)=>entry.payload).filter((entry)=>entry.executed===true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
    ctx.navigation.dispose(); ctx.physics.dispose();
  },35000);

  it('feeds a compact real STALL observation into the next planning round',async()=>{
    const ctx=await setup({blockedDoor:true});
    const requests=[];
    const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      if(requests.length===1) return {message:'',toolCalls:[{id:'open',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
      return {message:'door stalled; stopping',toolCalls:[]};
    })};
    const agent=new ToolCallingAgent({tools:ctx.tools,gateway,maxSteps:3});
    const result=await driveAgent(agent.run('打开柜门；如果失败就停止。'),ctx);
    expect(result.taskStatus).toBe('incomplete');
    expect(requests).toHaveLength(2);
    expect(requests[1].context.world.count).toBe(4);
    expect(requests[1].context.world.index).toEqual(expect.arrayContaining([
      {id:'agent_01',asset:'agent'},{id:'cabinet_01',asset:'cabinet'},{id:'cup_01',asset:'cup'},{id:'table_01',asset:'table'}
    ]));
    const task=requests[1].context.task;
    expect(task.schema).toBe('agentscape.task-observation.v1');
    expect(task.lastMutation).toMatchObject({tool:'approachAndInteract',args:{targetId:'cabinet_01',action:'open'},outcome:{state:'failed',reason:'STALL'}});
    expect(task.objects.map((item)=>item.id).sort()).toEqual(['agent_01','cabinet_01']);
    expect(task.actor).toMatchObject({id:'agent_01',carry:{status:'empty'}});
    expect(task.articulation[0]).toMatchObject({
      id:'cabinet_01',parts:[{
        partName:'door',status:'action-failed',verifiedAction:'close',live:{coordinate:expect.any(Number),error:expect.any(Number),tolerance:.08},
        last:{
          reason:'STALL',
          attribution:{status:'contact-evidence',evidence:'current-contact-at-failure',blockerCandidates:[{kind:'environment',environmentId:'sequence-stall-environment',colliderIndex:1}]}
        }
      }]
    });
    expect(task.recoveryHints[0]).toMatchObject({tool:'suggestRecoveryActions',status:'provisional',basedOn:'current-contact-at-failure',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door'}});
    expect(task.objects.some((item)=>item.id==='cup_01'||item.id==='table_01')).toBe(false);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },35000);

});

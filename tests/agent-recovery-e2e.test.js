import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../world/runtime/systems/SpatialSystem.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';
import { PolicyEngine } from '../core/PolicyEngine.js';
import { TraceRecorder } from '../core/TraceRecorder.js';
import { SkillRegistry } from '../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../agent/skills/registerCoreSkills.js';
import { AgentTools } from '../agent/AgentTools.js';
import { ToolCallingAgent } from '../agent/ToolCallingAgent.js';
import { assetManifests } from '../asset/manifests/index.js';

const floorMesh=()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(12,.2,10));m.position.y=-.1;m.updateMatrixWorld(true);return m;};
const cabinetObject=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};
const blockerObject=()=>{const g=new THREE.Group();const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.6,16));mesh.position.y=.3;g.add(mesh);g.updateMatrixWorld(true);return g;};
const blockerManifest={
  id:'recovery-blocker',type:'prop',label:'Movable blocker',source:{kind:'builtin'},actions:['pickup','drop','move'],
  physics:{body:'dynamic',mass:10,friction:5,colliders:[{shape:'cylinder',halfHeight:.3,radius:.18,translation:[0,.3,0]}]}
};

async function setup({environmentBlocker=false}={}){
  const store=new ObjectStore(),scene=new THREE.Scene(),ground=floorMesh(); scene.add(ground);
  const physics=createRapierPhysicsSystem(); await physics.init();
  const environment=[{shape:'box',halfExtents:[6,.1,5],translation:[0,-.1,0]}];
  if(environmentBlocker) environment.push({shape:'box',halfExtents:[.18,1,.18],translation:[-.64,1,1.08]});
  physics.addEnvironment(environment,{id:environmentBlocker?'recovery-fixed-environment':'recovery-floor'});
  const add=(id,assetId,object,manifest,position,state={})=>{
    object.position.fromArray(position); scene.add(object); object.updateMatrixWorld(true);
    store.add(id,{id,assetId,object,manifest:structuredClone(manifest),state:structuredClone(state)});
    physics.attach(id,store.get(id).manifest,object);
  };
  add('agent_01','agent',new THREE.Group(),assetManifests.agent,[0,0,4]);
  add('cabinet_01','cabinet',cabinetObject(),assetManifests.cabinet,[0,0,0],{parts:{door:'close'}});
  if(!environmentBlocker) add('blocker_01','recovery-blocker',blockerObject(),blockerManifest,[-.64,0,1.08]);
  for(let i=0;i<90;i++) physics.step(1/60,store);

  const events=new EventBus();
  const spatial=new SpatialSystem({store,scene});
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[ground],events});
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
  return {runtime,store,physics,spatial,navigation,locomotion,interactions,trace,mutate,tools};
}

async function driveAgent(promise,ctx,max=6500){
  let done=false,result,error;
  promise.then(v=>{done=true;result=v},e=>{done=true;error=e});
  for(let i=0;i<max&&!done;i++){
    ctx.locomotion.update(1/60);
    ctx.physics.step(1/60,ctx.store);
    ctx.interactions.update(1/60,new THREE.PerspectiveCamera());
    if(i%12===0) await new Promise(r=>setTimeout(r,0)); else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error('recovery agent did not settle');
  return result;
}

describe('verified blocker-aware recovery',()=>{
  it('picks up a current dynamic blocker, replans, retries the original open, and clears only then',async()=>{
    const ctx=await setup();
    let round=0;
    const requests=[];
    const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      round++;
      if(round===1) return {message:'',toolCalls:[{id:'open1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
      if(round===2) return {message:'',toolCalls:[{id:'suggest',name:'suggestRecoveryActions',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door'}}]};
      if(round===3) return {message:'',toolCalls:[{id:'recover',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
      if(round===4) return {message:'',toolCalls:[{id:'open2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
      return {message:'recovered and verified',toolCalls:[]};
    })};
    const agent=new ToolCallingAgent({tools:ctx.tools,gateway,maxSteps:7});
    const result=await driveAgent(agent.run('打开柜门；若被当前可拾取 blocker 卡住，安全恢复后重试原动作。'),ctx);
    expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
    const executed=result.execution.filter((entry)=>entry.executed);
    expect(executed.map((entry)=>[entry.tool,entry.outcome.state])).toEqual([
      ['approachAndInteract','failed'],
      ['suggestRecoveryActions','accepted'],
      ['recoverPickupBlocker','verified'],
      ['approachAndInteract','verified']
    ]);
    const suggestion=JSON.parse(requests[2].messages.find((message)=>message.role==='tool'&&message.name==='suggestRecoveryActions').content);
    expect(suggestion).toMatchObject({status:'recovery-proposed',proposals:[{eligible:true,tool:'recoverPickupBlocker',args:{blockerId:'blocker_01'},verification:{required:'retry-original-post-condition'}}]});
    expect(requests[3].context.task.unresolvedMutations).toHaveLength(1);
    expect(requests[3].context.task.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
    expect(ctx.store.get('blocker_01').state.heldBy).toMatchObject({kind:'agent',id:'agent_01'});
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('open');
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual([
      'skill:approachAndInteract','skill:recoverPickupBlocker','skill:approachAndInteract'
    ]);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },45000);

  it('refuses an Environment blocker and leaves the original open unresolved without any recovery mutation',async()=>{
    const ctx=await setup({environmentBlocker:true});
    let round=0;
    const requests=[];
    const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      round++;
      if(round===1) return {message:'',toolCalls:[{id:'open',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
      if(round===2) return {message:'',toolCalls:[{id:'suggest',name:'suggestRecoveryActions',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door'}}]};
      return {message:'fixed environment blocker cannot be recovered automatically',toolCalls:[]};
    })};
    const agent=new ToolCallingAgent({tools:ctx.tools,gateway,maxSteps:5});
    const result=await driveAgent(agent.run('打开柜门；如果固定环境阻挡则不要修改环境。'),ctx);
    expect(result.taskStatus).toBe('incomplete');
    expect(result.unresolvedMutations).toHaveLength(1);
    expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
    const suggestion=JSON.parse(requests[2].messages.find((message)=>message.role==='tool'&&message.name==='suggestRecoveryActions').content);
    expect(suggestion).toMatchObject({
      status:'recovery-unavailable',
      proposals:[{eligible:false,status:'ineligible',reason:'ENVIRONMENT_IMMOVABLE',blocker:{kind:'environment',environmentId:'recovery-fixed-environment',colliderIndex:1}}]
    });
    expect(result.execution.filter((entry)=>entry.executed).map((entry)=>entry.tool)).toEqual(['approachAndInteract','suggestRecoveryActions']);
    expect(ctx.mutate.mock.calls.map(([label])=>label)).toEqual(['skill:approachAndInteract']);
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('close');
    ctx.navigation.dispose(); ctx.physics.dispose();
  },35000);

});

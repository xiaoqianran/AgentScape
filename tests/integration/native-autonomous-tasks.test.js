import * as THREE from 'three';
import {it,expect} from 'vitest';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';
import {AgentTools} from '../../application/AgentTools.js';
import {ToolCallingAgent} from '../../modules/agent/ToolCallingAgent.js';

const box=(size,position)=>{
  const object=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());
  object.position.fromArray(position);return object;
};
async function pump(scene,promise){
  let done=false,value,error;
  promise.then(result=>{done=true;value=result;},failure=>{done=true;error=failure;});
  for(let n=0;n<22000&&!done;n++){scene.step();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();}
  if(error)throw error;expect(done).toBe(true);return value;
}
const response=(name,args)=>({message:'Plan from current evidence',toolCalls:[{id:crypto.randomUUID(),name,args}]});

async function fixture(prefix,sign,{overhead=false,serial=false}={}){
  const root=new THREE.Scene(),terrain=new THREE.Group();root.add(terrain);
  terrain.add(box([10,.2,4],[0,-.1,0]));
  for(let n=1;n<=8;n++){const height=n*.16;
    terrain.add(box([.5,height+.1,4],[sign*(5+(n-.5)*.5),(height-.1)/2,0]));
  }
  terrain.add(box([3,1.38,4],[sign*10.5,.59,0]));
  if(overhead)terrain.add(box([.4,.25,4.8],[0,4.3,0]));
  const gate=new THREE.Group(),link=box([.22,2.4,4.8],[0,1.2,0]);
  link.name=prefix+'_link';gate.add(link);root.add(gate);
  const secondGate=serial?gate.clone(true):null;
  if(secondGate){secondGate.position.x=sign*3;root.add(secondGate);}
  const load=box([.26,.26,.26],[sign*10.6,1.41,.2]);
  const support=box([1.1,.8,1.1],[-sign*3.6,.4,.9]);root.add(load,support);
  const host=await attachNativeScene({scene:root,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},autoStart:false,staticMeshes:[terrain]});
  const ids={actor:prefix+'_worker',gate:prefix+'_assembly',link:prefix+'_part',load:prefix+'_parcel',support:prefix+'_receiver'};
  const {scene}=host;
  scene.native.bindComponent({id:ids.gate,object:gate,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.12,.1,.1],translation:[0,-.2,0]}]},
    parts:{[ids.link]:{node:link.name,physics:{body:'dynamic',mass:.35,colliders:[{shape:'box',halfExtents:[.11,1.2,2.4]}]},
      joint:{type:'prismatic',axis:[0,1,0],limits:[0,2.8],motor:{stiffness:600,damping:45}}}}});
  if(secondGate){
    ids.secondGate=prefix+'_second_assembly';
    scene.native.bindComponent({id:ids.secondGate,object:secondGate,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.12,.1,.1],translation:[0,-.2,0]}]},
      parts:{[ids.link]:{node:link.name,physics:{body:'dynamic',mass:.35,colliders:[{shape:'box',halfExtents:[.11,1.2,2.4]}]},
        joint:{type:'prismatic',axis:[0,1,0],limits:[0,2.8],motor:{stiffness:600,damping:45}}}}});
  }
  scene.native.bindComponent({id:ids.load,object:load,physics:{body:'dynamic',mass:1,carryable:true,colliders:'mesh-bounds'}});
  scene.native.bindComponent({id:ids.support,object:support,physics:{body:'fixed',colliders:'mesh-bounds'},
    surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});
  await scene.addModel({id:ids.actor,asset:'builtin://agent',position:[-sign*1.2,0,0]});
  for(let n=0;n<40;n++)scene.step();
  return {...host,ids,load,support,root};
}

// A deterministic test gateway chooses from the actual current observation and
// tool responses. It exercises the production Agent loop, not online LLM quality.
it.each([['east',1],['west',-1]])('retrieves a native object across a closed gate and stairs using discovered ids (%s)',async(prefix,sign)=>{
  const host=await fixture(prefix,sign),{scene,world,ids,load,root}=host;
  try{
    let phase='plan',destination=null,diagnosis=null;
    const readLatest=request=>{
      const message=request.messages.filter(item=>item.role==='tool'&&item.name==='diagnoseSceneNavigation').at(-1);
      return message?JSON.parse(message.content):null;
    };
    const gateway={isConfigured:()=>true,complete:async request=>{
      const live=request.context.scene,task=request.context.task,actor=live.actors.agents[0].id;
      const parcel=live.project.entities.find(item=>item.physics?.state?.carryable===true);
      const receiver=live.project.entities.find(item=>item.physics?.surfaces?.length);
      expect(parcel?.id).toBeTruthy();expect(receiver?.id).toBeTruthy();
      const invoke=(interaction)=>response('interactScene',{goalId:'delivered',interaction});
      if(!task.plan){
        const pos=parcel.physics.position,approach=Math.sign(pos[0]-task.actor.position[0]);
        destination=[pos[0]-approach*1.15,pos[1]-.13,pos[2]];
        phase='initial-nav';
        return response('planSceneTask',{criteria:[{id:'delivered',kind:'relation-exists',subject:parcel.id,predicate:'ON',object:receiver.id,surfaceId:receiver.physics.surfaces[0].id}]});
      }
      if(task.plan.verification.status==='world-accepted')return {message:'Delivered',toolCalls:[]};
      if(phase==='initial-nav'){
        phase='diagnose';return invoke({action:'navigate',actor,position:destination});
      }
      if(phase==='diagnose'){
        expect(task.lastMutation.outcome.verified).toBe(false);
        phase='recover';return response('diagnoseSceneNavigation',{actor,position:destination});
      }
      if(phase==='recover'){
        diagnosis=readLatest(request);
        expect(diagnosis,JSON.stringify(diagnosis)).toMatchObject({status:'action-candidate',current:{reachable:false},recommendation:{provisional:true}});
        phase='check-route';return invoke(diagnosis.recommendation.interaction);
      }
      if(phase==='check-route'){
        expect(task.lastMutation.outcome.verified).toBe(true);
        phase='walk';return response('diagnoseSceneNavigation',{actor,position:destination});
      }
      if(phase==='walk'){
        expect(readLatest(request).current.reachable).toBe(true);
        phase='pickup';return invoke({action:'navigate',actor,position:destination});
      }
      if(phase==='pickup'){
        expect(task.actor.position[1]).toBeGreaterThan(1.1);
        const cap=parcel.capabilities.find(item=>item.name==='pickup'&&item.source==='native-physics');
        expect(cap.available||cap.canApproach).toBe(true);
        phase='place';return invoke({action:'invoke',actor,target:parcel.id,name:cap.name,source:cap.source,args:{}});
      }
      if(phase==='place'){
        expect(task.actor.carry.targetId).toBe(parcel.id);
        const cap=receiver.capabilities.find(item=>item.name==='place'&&item.source==='native-physics');
        expect(cap.available||cap.canApproach).toBe(true);
        phase='done';return invoke({action:'invoke',actor,target:receiver.id,name:cap.name,source:cap.source,args:{surfaceId:receiver.physics.surfaces[0].id}});
      }
      return {message:'Report current goal evidence',toolCalls:[]};
    }};
    const agent=new ToolCallingAgent({tools:new AgentTools(world,{actor:ids.actor}),gateway,maxSteps:20});
    const result=await pump(scene,agent.run('Retrieve the upstairs object and place it on the receiving table.'));
    expect(result,JSON.stringify(result)).toMatchObject({taskStatus:'completed',goalVerification:{status:'world-accepted'},unresolvedMutations:[]});
    expect(result.execution.some(entry=>entry.executed&&entry.tool==='interactScene'&&entry.outcome.state==='failed')).toBe(true);
    expect(result.execution.filter(entry=>entry.executed&&entry.tool==='diagnoseSceneNavigation')).toHaveLength(2);
    expect(diagnosis.recommendation.interaction).toMatchObject({target:ids.gate,partName:ids.link});
    expect(world.physics.getPosition(ids.actor)[1]).toBeLessThan(.2);
    expect(world.entities.get(ids.load).object).toBe(load);expect(load.parent).toBe(root);
    expect(result.goalVerification.checks[0]).toMatchObject({verified:true,source:'physics-support',evidenceKind:'solver-contact+spatial-geometry'});
  }finally{host.close();}
},30000);

it('rejects an apparently navigable native joint target when the real sweep introduces collision',async()=>{
  const host=await fixture('blocked',1,{overhead:true});
  try{
    const {scene,world,ids}=host;
    const before=world.physics.getArticulationState(ids.gate,ids.link).coordinate,history=scene.history().value;
    const result=await scene.diagnoseNavigation({actor:ids.actor,position:[9.7,1.28,0]});
    expect(result,JSON.stringify(result)).toMatchObject({status:'blocked',current:{reachable:false},recommendation:null});
    expect(result.candidates.some(item=>item.counterfactual.reachable&&item.eligibility.reason==='JOINT_SWEEP_INTRODUCES_COLLISION')).toBe(true);
    expect(world.physics.getArticulationState(ids.gate,ids.link).coordinate).toBe(before);
    expect(scene.history().value).toEqual(history);
    expect((await scene.previewNavigation({actor:ids.actor,position:[9.7,1.28,0]})).reachable).toBe(false);
  }finally{host.close();}
});


it('predicts a wide revolute passage but never certifies a real action that loses reach',async()=>{
  const root=new THREE.Scene(),ground=box([10,.2,4],[0,-.1,0]);root.add(ground);
  const assembly=new THREE.Group(),pivot=new THREE.Group();
  assembly.position.set(0,0,-2.2);pivot.position.set(0,1.2,0);pivot.name='pivot';
  pivot.add(box([.22,2.4,4.4],[0,0,2.2]));assembly.add(pivot);root.add(assembly);
  const host=await attachNativeScene({scene:root,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},autoStart:false,walkableMesh:ground});
  try{
    const {scene,world}=host;
    scene.native.bindComponent({id:'assembly',object:assembly,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1],translation:[0,-.2,0]}]},
      parts:{link:{node:'pivot',physics:{body:'dynamic',mass:.5,colliders:[{shape:'box',halfExtents:[.11,1.2,2.2],translation:[0,0,2.2]}]},
        joint:{type:'revolute',axis:[0,1,0],limits:[0,Math.PI/2],motor:{stiffness:600,damping:45}}}}});
    await scene.addModel({id:'agent',asset:'builtin://agent',position:[-1.2,0,0]});
    for(let n=0;n<40;n++)scene.step();
    const query={actor:'agent',position:[3,0,0]};
    const result=await scene.diagnoseNavigation(query);
    expect(result,JSON.stringify(result)).toMatchObject({status:'action-candidate',current:{reachable:false},recommendation:{interaction:{name:'rotateJoint',partName:'link'}}});
    expect(world.physics.getArticulationState('assembly','link').coordinate).toBeCloseTo(0,2);
    const job=scene.interact(result.recommendation.interaction);
    const terminal=await pump(scene,scene.waitJob(job.id));
    // The long link rotates beyond the actor's physical reach. A predicted
    // endpoint must never turn a partially executed motor action into success.
    expect(terminal,JSON.stringify(terminal)).toMatchObject({status:'failed',result:{value:{reason:'OUT_OF_REACH',physicsVerified:false}}});
    expect(scene.verify([{id:'receipt',kind:'interaction-verified',targetId:'assembly',partName:'link',capability:'ROTATEJOINT',source:'native-physics'}]).verification.status).toBe('unverified');
    expect((await scene.previewNavigation(query)).reachable).toBe(false);
  }finally{host.close();}
},30000);

it('restores live obstacles after a failed hypothetical TileCache restoration without granting a recommendation',async()=>{
  const host=await fixture('restore',1);
  try{
    const {scene,world,ids}=host;
    const query={actor:ids.actor,position:[9.7,1.28,0]};
    expect((await scene.previewNavigation(query)).reachable).toBe(false);
    const backend=world.navigation.backend,original=backend.syncObstacles.bind(backend);
    let replaced=false,failed=false;
    backend.syncObstacles=descriptors=>{
      const gate=descriptors.find(item=>item.objectId===ids.gate&&item.part===ids.link);
      if(gate?.position[1]>3)replaced=true;
      if(replaced&&!failed&&gate?.position[1]<2){failed=true;return {success:false,code:'INJECTED_RESTORE_FAILURE'};}
      return original(descriptors);
    };
    const diagnosis=await scene.diagnoseNavigation(query);
    expect(failed).toBe(true);expect(diagnosis.recommendation).toBeNull();
    expect(diagnosis.candidates[0].eligibility.reason).toBe('NAVIGATION_COUNTERFACTUAL_RESTORE_FAILED');
    expect((await scene.previewNavigation(query)).reachable).toBe(false);
    expect(world.physics.getArticulationState(ids.gate,ids.link).coordinate).toBeCloseTo(0,2);
  }finally{host.close();}
});


it.each([['serial_east',1],['serial_west',-1]])('replans two closed barriers one verified action at a time (%s)',async(prefix,sign)=>{
  const host=await fixture(prefix,sign,{serial:true});
  try{
    const {scene,world,ids}=host;
    const query={actor:ids.actor,position:[sign*9.7,1.28,0]};
    const history=scene.history().value;
    const first=await scene.diagnoseNavigation(query);
    expect(first,JSON.stringify(first)).toMatchObject({status:'action-candidate',current:{reachable:false,reason:'PARTIAL_PATH'},
      recommendation:{interaction:{target:ids.gate},progress:{kind:'partial-route-progress'}}});
    const candidate=first.candidates.find(c=>c.objectId===ids.gate);
    expect(candidate).toMatchObject({counterfactual:{reachable:false,progress:{kind:'partial-route-progress'}},
      eligibility:{eligible:true},actorEligibility:{eligible:true,approachChecked:true},sweep:{checked:true,actionIntroducesNoCollision:true}});
    expect(candidate.counterfactual.progress.gain).toBeGreaterThan(2);
    expect(first.candidates.find(c=>c.objectId===ids.secondGate)).toMatchObject({eligibility:{eligible:false},counterfactual:{reachable:false}});
    expect(scene.history().value).toEqual(history);
    expect((await scene.previewNavigation(query)).path).toEqual(first.current.path);
    for(const id of [ids.gate,ids.secondGate])expect(world.physics.getArticulationState(id,ids.link).coordinate).toBeCloseTo(0,2);
    const run=interaction=>{const job=scene.interact(interaction);return pump(scene,scene.waitJob(job.id));};
    expect(await run(first.recommendation.interaction)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
    const second=await scene.diagnoseNavigation(query);
    expect(second,JSON.stringify(second)).toMatchObject({status:'action-candidate',current:{reachable:false},
      recommendation:{interaction:{target:ids.secondGate}}});
    expect(second.recommendation.progress).toBeUndefined();
    expect(second.current.finalDistance).toBeLessThan(first.current.finalDistance-2);
    expect(second.candidates.find(c=>c.objectId===ids.secondGate)).toMatchObject({counterfactual:{reachable:true},actorEligibility:{eligible:true,approachChecked:true}});
    expect(await run(second.recommendation.interaction)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
    expect(await scene.diagnoseNavigation(query)).toMatchObject({status:'reachable',current:{reachable:true},recommendation:null});
    expect(await run({action:'navigate',...query})).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
    expect(world.physics.getPosition(ids.actor)[1]).toBeGreaterThan(1.1);
  }finally{host.close();}
},30000);

it('does not recommend partial progress when the first serial barrier cannot sweep safely',async()=>{
  const host=await fixture('serial_blocked',1,{serial:true,overhead:true});
  try{
    const {scene,world,ids}=host;
    const query={actor:ids.actor,position:[9.7,1.28,0]};
    const before=scene.history().value;
    const diagnosis=await scene.diagnoseNavigation(query);
    expect(diagnosis,JSON.stringify(diagnosis)).toMatchObject({status:'blocked',recommendation:null,current:{reachable:false}});
    expect(diagnosis.candidates.find(c=>c.objectId===ids.gate)).toMatchObject({counterfactual:{reachable:false,progress:{kind:'partial-route-progress'}},
      eligibility:{eligible:false,reason:'JOINT_SWEEP_INTRODUCES_COLLISION'}});
    expect(scene.history().value).toEqual(before);
    expect(world.physics.getArticulationState(ids.gate,ids.link).coordinate).toBeCloseTo(0,2);
    expect((await scene.previewNavigation(query)).path).toEqual(diagnosis.current.path);
  }finally{host.close();}
});

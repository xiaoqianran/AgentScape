import * as THREE from 'three';
import {describe,it,expect,vi} from 'vitest';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';

const box=(x,y,z)=>new THREE.Mesh(new THREE.BoxGeometry(x,y,z),new THREE.MeshBasicMaterial());
async function fixture({x=.65,mass=1,enabled=true,wall=false,rotate=false,parented=false,custom=false,actorX=0}={}){
  const scene=new THREE.Scene(),ground=box(20,.2,20);
  ground.position.y=-.1;scene.add(ground);
  const object=rotate?new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.16),new THREE.MeshBasicMaterial()):box(.4,.4,.4);
  const parent=new THREE.Group();
  if(parented){parent.rotation.y=.7;parent.position.set(.15,0,-.1);scene.add(parent);parent.add(object);object.position.copy(parent.worldToLocal(new THREE.Vector3(x,rotate?.8:.2,0)));}
  else{scene.add(object);object.position.set(x,rotate?.8:.2,0);}
  const host=await attachNativeScene({scene,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},autoStart:false,walkableMesh:ground});
  const binding=host.scene.native.bindComponent({id:'novel',object,physics:{body:'dynamic',mass,manipulable:enabled,
    ...(rotate?{colliders:[{shape:'cylinder',radius:.3,halfHeight:.08}],lockTranslation:[true,true,true],lockRotation:[true,false,true]}:{colliders:'mesh-bounds'})},
    actions:custom?[{name:'push',execute(){return null;},verify(){return true;}}]:[]});
  if(wall){const obstacle=box(.4,.8,.8);obstacle.position.set(1.5,.4,0);scene.add(obstacle);
    host.scene.native.bindComponent({id:'wall',object:obstacle,physics:{body:'fixed',colliders:'mesh-bounds'}});}
  await host.scene.addModel({id:'actor',asset:'builtin://agent',position:[actorX,0,0]});
  for(let i=0;i<30;i++)host.scene.step();
  return {...host,object,binding,parent};
}
async function finish(scene,job,limit=1200){
  for(let n=0;n<limit&&scene.getJob(job.id).status==='running';n++){
    scene.step();
    if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}
const invoke=(scene,name,args)=>scene.interact({action:'invoke',target:'novel',actor:'actor',name,source:'native-physics',args});
const receipt=(scene,capability,source='native-physics')=>scene.verify([{id:'acted',kind:'interaction-verified',targetId:'novel',capability,source}]);

describe('native rigid-body manipulation through the existing InteractionSystem',()=>{
  it.each([.5,5])('pushes a native %s kg object with actual force and no ObjectStore or pose assignment',async mass=>{
    const host=await fixture({mass});const {scene,world,object}=host;
    try{
      expect(scene.inspect('novel',{actor:'actor'}).capabilities).toEqual(expect.arrayContaining([expect.objectContaining({source:'native-physics',name:'push',available:true})]));
      expect(scene.observe().project.entities.find(e=>e.id==='novel').actions).toHaveLength(3);
      const force=vi.spyOn(world.physics,'applyForce'),teleport=vi.spyOn(world.physics,'setPosition');
      const history=scene.history().value,before=scene.observe({limit:1}).revision;
      const result=await finish(scene,invoke(scene,'push',{direction:[1,0,0],distance:.65}));
      expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,source:'native-physics',
        evidenceKind:'rigid-body-force',historyRecorded:true,targetReached:true,settled:true}}});
      expect(result.result.value.progress).toBeCloseTo(.65,1);
      expect(force).toHaveBeenCalled();expect(teleport.mock.calls.filter(call=>call[0]==='novel')).toHaveLength(0);
      expect(world.store.has('novel')).toBe(false);
      expect(world.entities.get('novel').object).toBe(object);
      expect(object.position.x).toBeCloseTo(world.physics.getPosition('novel')[0],5);
      expect(scene.history().value.undo).toBe(history.undo+1);
      expect(scene.observe({limit:1}).revision).toBeGreaterThan(before);
      expect(receipt(scene,'PUSH').verification.status).toBe('verified');
    }finally{host.close();}
  });
  it('drags the original host mesh toward the actor and observes real contact',async()=>{
    const host=await fixture({x:-.85});const {scene,world}=host;
    try{
      const result=await finish(scene,invoke(scene,'drag',{direction:[1,0,0],distance:.3}));
      expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,action:'drag',contactPoint:expect.any(Array)}}});
      expect(result.result.value.progress).toBeCloseTo(.3,1);
      expect(world.physics.getPosition('novel')[0]).toBeCloseTo(-.55,1);
      expect(receipt(scene,'DRAG').verification.status).toBe('verified');
    }finally{host.close();}
  });
  it('rotates a nested native rotor around a world-space axis using torque',async()=>{
    const host=await fixture({x:.85,rotate:true,parented:true});const {scene,world,object,parent}=host;
    try{
      const before=object.getWorldQuaternion(new THREE.Quaternion());
      const torque=vi.spyOn(world.physics,'applyTorque');
      const result=await finish(scene,invoke(scene,'rotate',{axis:[0,1,0],angle:1,maxTorque:100}));
      expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,evidenceKind:'rigid-body-torque'}}});
      expect(torque).toHaveBeenCalled();
      expect(result.result.value.progress).toBeCloseTo(1,1);
      const after=object.getWorldQuaternion(new THREE.Quaternion());
      expect(after.angleTo(before)).toBeCloseTo(1,1);expect(object.parent).toBe(parent);
      expect(receipt(scene,'ROTATE').verification.status).toBe('verified');
    }finally{host.close();}
  });
  it('preserves partial displacement when a real collider blocks movement',async()=>{
    const host=await fixture({wall:true});const {scene,world}=host;
    try{
      const result=await finish(scene,invoke(scene,'push',{direction:[1,0,0],distance:1}));
      expect(result.status).toBe('failed');
      expect(result.result.value.physicsVerified).toBe(false);
      expect(result.result.value.progress).toBeGreaterThan(.05);
      expect(world.physics.getPosition('novel')[0]).toBeLessThan(1.15);
      expect(receipt(scene,'PUSH').verification.status).toBe('unverified');
    }finally{host.close();}
  });
  it('cancels without more force, invalidates an earlier successful receipt, and clears the identity on removal',async()=>{
    const host=await fixture();const {scene,world,binding}=host;
    try{
      const first=await finish(scene,invoke(scene,'push',{direction:[1,0,0],distance:.2}));
      expect(first.status).toBe('succeeded');expect(receipt(scene,'PUSH').verification.status).toBe('verified');
      const force=vi.spyOn(world.physics,'applyForce');
      const job=invoke(scene,'push',{direction:[1,0,0],distance:.5});
      for(let n=0;n<45;n++){scene.step();await Promise.resolve();}
      expect(force).toHaveBeenCalled();scene.cancelJob(job.id);
      const count=force.mock.calls.length,result=await finish(scene,job);
      expect(result.status).toBe('cancelled');expect(result.result.verification.status).toBe('unverified');
      expect(force.mock.calls.length).toBe(count);
      expect(receipt(scene,'PUSH').verification.status).toBe('unverified');
      expect(world.interactions.physicalTasks.size).toBe(0);
      expect(binding.remove()).toBe(true);expect(receipt(scene,'PUSH').verification.status).toBe('unverified');
    }finally{host.close();}
  });
  it('never grants operations by name, separates duplicate custom actions, and refuses unapproved bodies',async()=>{
    const disabled=await fixture({enabled:false});
    try{
      expect(disabled.scene.inspect('novel').capabilities).toEqual([]);
      const result=await finish(disabled.scene,disabled.scene.interact({actor:'actor',target:'novel',action:'push',args:{direction:[1,0,0],distance:.2}}));
      expect(result.result.value.reason).toBe('NATIVE_MANIPULATION_NOT_ENABLED');
    }finally{disabled.close();}
    const host=await fixture({custom:true});
    try{
      const {scene}=host;
      expect(()=>scene.interact({action:'invoke',target:'novel',actor:'actor',name:'push',args:{direction:[1,0,0],distance:.2}})).toThrow('ACTION_SOURCE_REQUIRED');
      expect((await finish(scene,invoke(scene,'push',{direction:[1,0,0],distance:.2}))).status).toBe('succeeded');
      expect(receipt(scene,'PUSH').verification.status).toBe('verified');
      expect(scene.verify([{id:'ambiguous',kind:'interaction-verified',targetId:'novel',capability:'push'}]).verification.status).toBe('unverified');
      expect(receipt(scene,'PUSH','project').verification.status).toBe('unverified');
    }finally{host.close();}
  });
});

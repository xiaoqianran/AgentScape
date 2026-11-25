import * as THREE from 'three';
import {describe,it,expect,vi} from 'vitest';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';

const box=(x,y,z)=>new THREE.Mesh(new THREE.BoxGeometry(x,y,z),new THREE.MeshBasicMaterial());
async function fixture({mass=1,carryable=true,blocked=false,fakeSurface=false,managedSupport=false,wrongSupport=false}={}){
  const root=new THREE.Scene(),ground=box(20,.2,20);ground.position.y=-.1;root.add(ground);
  const object=box(.26,.26,.26);object.position.set(.72,.13,0);root.add(object);
  const support=box(1.1,.8,1.1);support.position.set(3.1,.4,0);root.add(support);
  if(blocked)support.position.z=2.5;
  if(wrongSupport){support.position.z=2;object.position.set(3.1,1.4,0);}
  const host=await attachNativeScene({scene:root,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},autoStart:false,walkableMesh:ground});
  const binding=host.scene.native.bindComponent({id:'load',object,physics:{body:'dynamic',mass,carryable,manipulable:true,colliders:'mesh-bounds'}});
  if(managedSupport){
    root.remove(support);
    await host.scene.addModel({id:'support',asset:'builtin://table',position:[3.1,0,0]});
  }else{
    host.scene.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},
      surfaces:[{id:'top',localPosition:[0,fakeSurface?.85:.4,wrongSupport?-2:0],size:[1.1,1.1]}]});
  }
  if(wrongSupport){const actual=box(1.1,.8,1.1);actual.position.set(3.1,.4,0);root.add(actual);
    host.scene.native.bindComponent({id:'other_support',object:actual,physics:{body:'fixed',colliders:'mesh-bounds'}});}
  if(blocked){
    // A host-controlled obstacle enters the route after the query, so the
    // real carried-collider safety check remains exercised with correct navmesh.
    const obstacle=box(.18,.35,2.5);obstacle.position.set(1.8,.95,6);root.add(obstacle);
    host.scene.native.bindComponent({id:'obstacle',object:obstacle,physics:{body:'kinematic',colliders:'mesh-bounds'}});
  }
  await host.scene.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});
  for(let i=0;i<30;i++)host.scene.step();
  return {...host,object,binding,root,support};
}
async function finish(scene,job,limit=2000){
  for(let n=0;n<limit&&scene.getJob(job.id).status==='running';n++){
    scene.step();
    if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}
const invoke=(scene,name,target='load',args={})=>scene.interact({action:'invoke',name,target,actor:'actor',source:'native-physics',args});
const receipt=(scene,targetId,capability)=>scene.verify([{id:'receipt',kind:'interaction-verified',targetId,capability,source:'native-physics'}]).verification.status;
const supportGoal={id:'on-support',kind:'relation-exists',subject:'load',predicate:'ON',object:'support',surfaceId:'top'};
const onSupport=scene=>scene.verify([supportGoal]).value.checks[0];
const verifyHeld=(scene,held)=>scene.verify([{id:'held',kind:'state-equals',targetId:'load',stateKey:'held',source:'native-physics',value:held}]).verification.status;

describe('native carry reuses the existing anchor, locomotion and placement settle',()=>{
  it('picks up, carries and places an original mesh on an explicit native support with real contact',async()=>{
    const host=await fixture();const {scene,world,object,root}=host;
    try{
      expect(scene.inspect('load',{actor:'actor'}).capabilities).toEqual(expect.arrayContaining([expect.objectContaining({name:'pickup',source:'native-physics',available:true})]));
      const before=scene.history().value;
      const pick=await finish(scene,invoke(scene,'pickup'));
      expect(pick,JSON.stringify(pick)).toMatchObject({status:'succeeded',result:{value:{status:'held',graspVerified:false,historyRecorded:true}}});
      expect(world.physics.manipulationBody('load').body).toBe('kinematic');
      expect(verifyHeld(scene,true)).toBe('verified');expect(receipt(scene,'load','PICKUP')).toBe('verified');
      expect(world.store.has('load')).toBe(false);expect(world.entities.get('load').object).toBe(object);
      await scene.history({operation:'undo'});
      expect(verifyHeld(scene,false)).toBe('verified');
      expect(world.physics.manipulationBody('load').body).toBe('dynamic');
      await scene.history({operation:'redo'});
      expect(verifyHeld(scene,true)).toBe('verified');
      expect(world.physics.manipulationBody('load').body).toBe('kinematic');
      expect(receipt(scene,'load','PICKUP')).toBe('unverified');
      const push=await finish(scene,invoke(scene,'push','load',{direction:[1,0,0],distance:.3}));
      expect(push.result.value.reason).toBe('HANDS_FULL');
      const carry=await finish(scene,scene.interact({action:'navigate',actor:'actor',position:[1.25,0,-.8]}));
      expect(carry,JSON.stringify(carry)).toMatchObject({status:'succeeded',result:{value:{status:'arrived',heldId:'load',graspVerified:false}}});
      expect(receipt(scene,'load','CARRY')).toBe('verified');expect(world.interactions.heldByAgent('actor')).toBe('load');
      const available=scene.inspect('support',{actor:'actor'}).capabilities.find(c=>c.name==='place'&&c.source==='native-physics');
      expect(available.available===true||available.canApproach===true).toBe(true);
      const place=await finish(scene,invoke(scene,'place','support',{surfaceId:'top'}));
      expect(place,JSON.stringify(place)).toMatchObject({status:'succeeded',result:{value:{status:'placed',settled:true,supportVerified:true,physicsVerified:true,graspVerified:false,support:{contactVerified:true}}}});
      expect(place.result.value.support.contacts.every(c=>c.normal[1]<-.7)).toBe(true); expect(verifyHeld(scene,false)).toBe('verified');expect(receipt(scene,'support','PLACE')).toBe('verified');
      expect(onSupport(scene)).toMatchObject({verified:true,source:'physics-support',evidenceKind:'solver-contact+spatial-geometry'});
      expect(world.physics.manipulationBody('load').body).toBe('dynamic');
      expect(object.parent).toBe(root);expect(object.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(.93,1);
      expect(scene.history().value.undo).toBeGreaterThanOrEqual(before.undo+3);
      const placed=world.physics.getPosition('load');
      await scene.history({operation:'undo'});
      expect(verifyHeld(scene,true)).toBe('verified');
      expect(world.interactions.heldByAgent('actor')).toBe('load');
      expect(world.physics.manipulationBody('support').body).toBe('fixed');
      await scene.history({operation:'redo'});
      expect(verifyHeld(scene,false)).toBe('verified');
      expect(world.physics.getPosition('load')).toEqual(placed);
      expect(world.entities.get('load').object).toBe(object);
      for(let n=0;n<60;n++)scene.step();
      // The same physical support contact is used for the lift exclusion.
      const again=await finish(scene,invoke(scene,'pickup'));
      expect(again,JSON.stringify(again)).toMatchObject({status:'succeeded',result:{value:{status:'held',supportIds:['support']}}});
      expect(onSupport(scene).verified).toBe(false);
    }finally{host.close();}
  });
  it('uses the same placement executor with a managed support',async()=>{
    const host=await fixture({managedSupport:true});const {scene,world}=host;
    try{
      expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      const place=await finish(scene,scene.interact({action:'place',actor:'actor',target:'support'}));
      expect(place,JSON.stringify(place)).toMatchObject({status:'succeeded',result:{value:{supportVerified:true,support:{contactVerified:true}}}});
      expect(receipt(scene,'support','PLACE')).toBe('verified');
      expect(world.interactions.heldByAgent('actor')).toBeNull();
      expect(onSupport(scene).verified).toBe(true);
    }finally{host.close();}
  });
  it('does not certify a declared support that does not actually support the released object',async()=>{
    const host=await fixture({fakeSurface:true});const {scene}=host;
    try{
      expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      const place=await finish(scene,invoke(scene,'place','support',{surfaceId:'top'}));
      expect(place.status).toBe('failed');expect(receipt(scene,'support','PLACE')).toBe('unverified');
      expect(place.result.value.supportVerified).toBe(false);
      expect(onSupport(scene).verified).toBe(false);
    }finally{host.close();}
  });
  it.each([{carryable:false,mass:1},{carryable:true,mass:20}])('rejects unapproved or overweight native bodies (%j)',async options=>{
    const host=await fixture(options);const {scene,world}=host;
    try{
      const available=scene.inspect('load',{actor:'actor'}).capabilities.find(c=>c.name==='pickup');
      if(options.carryable)expect(available).toMatchObject({available:false,reason:'CARRY_MASS_EXCEEDED'});
      else expect(available).toBeUndefined();
      const result=await finish(scene,scene.interact({action:'pickup',actor:'actor',target:'load'}));
      expect(result.status).toBe('failed');expect(world.interactions.heldByAgent('actor')).toBeNull();
      expect(world.physics.manipulationBody('load').body).toBe('dynamic');
    }finally{host.close();}
  });
  it('drops a held body with real settle and releases ownership on binding removal',async()=>{
    const host=await fixture();const {scene,world,binding}=host;
    try{
      expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      const drop=await finish(scene,invoke(scene,'drop'));
      expect(drop,JSON.stringify(drop)).toMatchObject({status:'succeeded',result:{value:{released:true,settled:true,graspVerified:false}}});
      expect(receipt(scene,'load','DROP')).toBe('verified');expect(world.interactions.heldByAgent('actor')).toBeNull();
      expect(binding.remove()).toBe(true);expect(receipt(scene,'load','DROP')).toBe('unverified');
    }finally{host.close();}
  });
  it('clears carried identity when the native binding is removed while held',async()=>{
    const host=await fixture();const {scene,world,binding}=host;
    try{
      expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      expect(binding.remove()).toBe(true);
      expect(world.interactions.heldByAgent('actor')).toBeNull();expect(world.physics.entries.has('load')).toBe(false);
      expect(receipt(scene,'load','PICKUP')).toBe('unverified');
    }finally{host.close();}
  });
  it('blocks the actual carried collider before the character reaches a wall',async()=>{
    const host=await fixture({blocked:true});const {scene,world}=host;
    try{
      expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      const job=scene.interact({action:'navigate',actor:'actor',position:[2.4,0,0]});
      for(let n=0;n<100&&!world.locomotion.tasks.has('actor');n++)await new Promise(resolve=>setTimeout(resolve,0));
      expect(world.locomotion.tasks.has('actor')).toBe(true);
      world.entities.get('obstacle').object.position.z=0;
      const carry=await finish(scene,job);
      expect(carry,JSON.stringify(carry)).toMatchObject({status:'failed',result:{value:{reason:'CARRIED_OBJECT_BLOCKED',carry:{targetId:'load'}}}});
      expect(world.interactions.heldByAgent('actor')).toBe('load');
      expect(world.physics.getPosition('load')[0]).toBeLessThan(1.72);
      expect(receipt(scene,'load','CARRY')).toBe('unverified');
    }finally{host.close();}
  });
  it('rejects a geometrically matching surface if the real supporting collider is a different entity',async()=>{
    const host=await fixture({wrongSupport:true});const {scene,world}=host;
    try{
      for(let n=0;n<150;n++)scene.step();
      const pending=world.interactions.waitForPlacementSettle('load','support','top');
      for(let n=0;n<100;n++)scene.step();
      const result=await pending;
      expect(result).toMatchObject({status:'place-failed',settled:true,supportVerified:false,support:{geometrySupported:true,contactVerified:false}});
      expect(world.physics.articulationContacts('load','$root').some(c=>c.target.objectId==='other_support')).toBe(true);
    }finally{host.close();}
  });
  it('does not allow a cancelled pickup to attach late',async()=>{
    const host=await fixture();const {scene,world}=host;
    try{
      const job=invoke(scene,'pickup');scene.cancelJob(job.id);
      const result=await finish(scene,job);
      expect(result.status).toBe('cancelled');expect(world.interactions.heldByAgent('actor')).toBeNull();
      expect(receipt(scene,'load','PICKUP')).toBe('unverified');
    }finally{host.close();}
  });
});

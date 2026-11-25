import * as THREE from 'three';
import {describe,it,expect,vi} from 'vitest';
import {openCodeProject} from '../../application/native-scene/CodeProject.js';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';
import {WorldStorage} from '../../application/scene/WorldStorage.js';

const project={schema:'agentscape.code-project',schemaVersion:1,id:'native_state',name:'Native state',resources:{},source:"export function createProject({THREE}){\n  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();\n  const make=(size)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());\n  const floor=make([20,.2,20]);floor.position.y=-.1;scene.add(floor);\n  const parent=new THREE.Group();parent.position.set(.2,0,.1);parent.rotation.y=.3;scene.add(parent);\n  const load=make([.26,.26,.26]);load.name='NativeLoad';parent.add(load);\n  load.position.copy(parent.worldToLocal(new THREE.Vector3(.72,.13,0)));\n  const support=make([1.1,.8,1.1]);support.position.set(3.1,.4,0);scene.add(support);\n  const mover=make([.2,.2,.2]);mover.position.set(7,.8,0);scene.add(mover);\n  return {scene,camera,renderer:{render(){},extensions:{has:()=>false}},walkableMesh:floor,\n    async setup({scene:api}){\n      api.native.bindComponent({id:'load',object:load,physics:{body:'dynamic',mass:1,carryable:true,manipulable:true,colliders:'mesh-bounds'}});\n      api.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});\n      api.native.bindComponent({id:'mover',object:mover,physics:{body:'kinematic',colliders:'mesh-bounds'}});\n      if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});\n    },\n    serialize(){return {mover:mover.position.toArray()};},\n    restore(state){mover.position.fromArray(state.mover);}\n  };\n}"};
const open=input=>openCodeProject({project:input||project,authorized:true,autoStart:false});
const bodyRow=(world,id='load')=>world.snapshot().nativePhysics.bodies.find(b=>b.id===id);
const invoke=(scene,name,target='load',args={})=>scene.interact({action:'invoke',name,target,actor:'actor',source:'native-physics',args});
const vectorClose=(a,b,tolerance=1e-5)=>expect(Math.hypot(...a.map((n,i)=>n-b[i]))).toBeLessThan(tolerance);
async function finish(scene,job,limit=1800){
  for(let n=0;n<limit&&scene.getJob(job.id).status==='running';n++){
    scene.step();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');return scene.waitJob(job.id);
}
const settle=scene=>{for(let n=0;n<100;n++)scene.step();};
const receipt=(scene,id,capability)=>scene.verify([{id:'receipt',kind:'interaction-verified',targetId:id,capability,source:'native-physics'}]).verification.status;
const stripIntegrity=({integrity,...data})=>data;

describe('Native physics persistence and shared history',()=>{
  it('restores actual world-space pose, nonzero velocity, sleep and source-owned kinematics in a new CodeProject',async()=>{
    const host=await open();let fresh;
    try{
      const {scene,world}=host;settle(scene);
      expect(bodyRow(world).motion.sleeping).toBe(true);
      const body=world.physics.entries.get('load').body;
      const position=[1.4,2,.2],rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.65).toArray();
      world.physics.setHeldPose('load',position,rotation);
      world.physics.backend.setBodyMotion(body,{linearVelocity:[.8,1.2,-.4],angularVelocity:[.2,.3,-.1],wake:true});
      world.entities.get('mover').object.position.set(5.5,1.25,.4);scene.step();
      const expected=bodyRow(world);
      const saved=(await host.save()).value;
      expect(saved.runtime.snapshot.nativePhysics.bodies).toHaveLength(3);
      expect(saved.runtime.nativeSourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(saved.runtime.snapshot.nativePhysics.bodies.every(b=>!Object.hasOwn(b,'bindingId'))).toBe(true);
      expect(saved.runtime.snapshot.nativePhysics.bodies.find(b=>b.id==='mover')).not.toHaveProperty('pose');
      fresh=await open(JSON.stringify(saved));
      expect(fresh.nativeRestore).toEqual({restored:3,skipped:[]});
      expect(fresh.world.store.has('load')).toBe(false);
      const actual=bodyRow(fresh.world);
      vectorClose(actual.pose.position,expected.pose.position);vectorClose(actual.pose.rotation,expected.pose.rotation);
      vectorClose(actual.motion.linearVelocity,expected.motion.linearVelocity);vectorClose(actual.motion.angularVelocity,expected.motion.angularVelocity);
      expect(actual.motion.sleeping).toBe(false);
      vectorClose(fresh.world.entities.get('load').object.getWorldPosition(new THREE.Vector3()).toArray(),actual.pose.position);
      vectorClose(fresh.world.physics.getPosition('mover'),[5.5,1.25,.4]);
      const before=fresh.world.physics.getPosition('load');fresh.scene.step();
      expect(fresh.world.physics.getPosition('load')[0]).toBeGreaterThan(before[0]);
      settle(fresh.scene);for(let i=0;i<360;i++)fresh.scene.step();
      const sleepy=bodyRow(fresh.world);expect(sleepy.motion.sleeping).toBe(true);
      const again=await open((await fresh.save()).value);
      try{expect(bodyRow(again.world).motion.sleeping).toBe(true);vectorClose(bodyRow(again.world).pose.position,sleepy.pose.position);}
      finally{again.close();}
    }finally{fresh?.close();host.close();}
  });
  it('saves while carrying, restores ownership and resumes moving and placing without restoring action receipts',async()=>{
    const host=await open();let fresh;
    try{
      settle(host.scene);const pick=await finish(host.scene,invoke(host.scene,'pickup'));expect(pick.status).toBe('succeeded');
      expect(pick.result.value.historyRecorded).toBe(true);
      const saved=(await host.save()).value;
      const row=saved.runtime.snapshot.nativePhysics.bodies.find(b=>b.id==='load');
      expect(row).toMatchObject({body:'dynamic',heldBy:{id:'actor',kind:'agent',anchor:'hold'}});
      fresh=await open(saved);
      expect(fresh.world.interactions.heldByAgent('actor')).toBe('load');
      expect(fresh.world.physics.manipulationBody('load').body).toBe('kinematic');
      expect(receipt(fresh.scene,'load','PICKUP')).toBe('unverified');
      vectorClose(fresh.world.physics.getPosition('load'),row.pose.position);
      const carry=await finish(fresh.scene,fresh.scene.interact({action:'navigate',actor:'actor',position:[1.25,0,-.8]}));
      expect(carry,JSON.stringify(carry)).toMatchObject({status:'succeeded',result:{value:{historyRecorded:true,heldId:'load'}}});
      const place=await finish(fresh.scene,invoke(fresh.scene,'place','support',{surfaceId:'top'}));
      expect(place,JSON.stringify(place)).toMatchObject({status:'succeeded',result:{value:{historyRecorded:true,support:{contactVerified:true}}}});
      expect(fresh.world.interactions.heldByAgent('actor')).toBeNull();
    }finally{fresh?.close();host.close();}
  });
  it('keeps native colliders, geometry, and identity during interleaved managed/native history, and clears stale receipts',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      settle(scene);const entity=world.entities.get('load'),object=entity.object,geometry=object.geometry;
      const before=bodyRow(world);
      const push=await finish(scene,invoke(scene,'push','load',{direction:[1,0,0],distance:.25}));
      expect(push,JSON.stringify(push)).toMatchObject({status:'succeeded',result:{value:{historyRecorded:true}}});
      const after=bodyRow(world);
      await scene.addModel({id:'managed',asset:'builtin://cup',position:[-2,1,0]});
      await scene.history({operation:'undo'});expect(world.store.has('managed')).toBe(false);
      expect(world.physics.entries.get('load').root).toBe(object);
      expect(world.physics.manipulationBody('support').body).toBe('fixed');
      await scene.history({operation:'undo'});
      vectorClose(bodyRow(world).pose.position,before.pose.position);
      vectorClose(bodyRow(world).motion.linearVelocity,before.motion.linearVelocity);
      expect(receipt(scene,'load','PUSH')).toBe('unverified');
      await scene.history({operation:'redo'});vectorClose(bodyRow(world).pose.position,after.pose.position);
      await scene.history({operation:'redo'});expect(world.store.has('managed')).toBe(true);
      expect(world.entities.get('load')).toBe(entity);expect(object.geometry).toBe(geometry);
      expect(world.physics.entries.get('support').root).toBe(world.entities.get('support').object);
    }finally{host.close();}
  });
  it('rejects stale history on same-name rebinding without losing the new body',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      settle(scene);const extra=new THREE.Mesh(new THREE.BoxGeometry(.25,.25,.25),new THREE.MeshBasicMaterial());
      extra.position.set(-3,.125,0);scene.native.scene.add(extra);
      const options={id:'extra',object:extra,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}};
      const binding=scene.native.bindComponent(options);
      await scene.addModel({id:'managed',asset:'builtin://cup',position:[-1,1,2]});
      expect(binding.remove()).toBe(true);
      scene.native.bindComponent(options);const before=world.snapshot();
      await expect(scene.history({operation:'undo'})).rejects.toMatchObject({code:'NATIVE_PHYSICS_BINDING_MISMATCH'});
      expect(world.snapshot()).toEqual(before);
      expect(world.physics.entries.get('extra').root).toBe(extra);
      expect(world.store.has('managed')).toBe(true);
    }finally{host.close();}
  });
  it('validates owner references and rolls back a failed native attachment restore transaction',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      settle(scene);expect((await finish(scene,invoke(scene,'pickup'))).status).toBe('succeeded');
      const before=world.snapshot(),original=world.entities.get('load').object,held=before.nativePhysics.bodies.find(b=>b.id==='load');
      const malformed=structuredClone(before);malformed.nativePhysics.bodies.find(b=>b.id==='load').heldBy.id='missing';
      await expect(world.restore(malformed)).rejects.toMatchObject({code:'NATIVE_PHYSICS_HELD_OWNER_INVALID'});
      expect(world.snapshot()).toEqual(before);
      const bad=structuredClone(before);bad.nativePhysics.bodies.find(b=>b.id==='load').pose.position=[10,1,0];
      await expect(world.restore(bad)).rejects.toMatchObject({code:'NATIVE_PHYSICS_HELD_POSE_INVALID'});
      expect(world.entities.get('load').object).toBe(original);
      expect(world.interactions.heldByAgent('actor')).toBe('load');
      vectorClose(world.physics.getPosition('load'),held.pose.position);
      expect(world.physics.manipulationBody('load').body).toBe('kinematic');
      expect(world.physics.manipulationBody('support').body).toBe('fixed');
      expect(world.mutationOwner).toBeNull();expect(receipt(scene,'load','PICKUP')).toBe('verified');
      expect((await finish(scene,invoke(scene,'drop'))).status).toBe('succeeded');
    }finally{host.close();}
  });
  it('rejects changed native physics for an identical source, and reports deliberate source-edit migration',async()=>{
    const host=await open();let fresh;
    try{
      settle(host.scene);
      const saved=(await host.save()).value;
      const tampered=stripIntegrity(structuredClone(saved));tampered.runtime.snapshot.nativePhysics.bodies.find(b=>b.id==='load').signature='f'.repeat(64);
      await expect(open(tampered)).rejects.toMatchObject({code:'NATIVE_PHYSICS_BINDING_MISMATCH'});
      const changed=stripIntegrity(structuredClone(saved));changed.source=changed.source.replace('mass:1,carryable:true','mass:2,carryable:true');
      fresh=await open(changed);
      expect(fresh.nativeRestore).toMatchObject({restored:2,skipped:[{id:'load',reason:'BINDING_CHANGED_OR_MISSING'}]});
      expect(fresh.world.physics.manipulationBody('load').mass).toBeCloseTo(2,4);
      expect((await finish(host.scene,invoke(host.scene,'pickup'))).status).toBe('succeeded');
      const held=stripIntegrity((await host.save()).value);held.source=changed.source;
      await expect(open(held)).rejects.toMatchObject({code:'NATIVE_PHYSICS_BINDING_MISMATCH'});
      expect(host.world.interactions.heldByAgent('actor')).toBe('load');
    }finally{fresh?.close();host.close();}
  });
});

class MemoryBlocks{
  blocks=new Map();
  async write(hash,bytes){this.blocks.set(hash,bytes.slice());}
  async read(hash,size){const bytes=this.blocks.get(hash);if(!bytes||bytes.length!==size)throw new Error('MISSING_BLOCK');return bytes.slice();}
}
async function overlayHost(){
  const root=new THREE.Scene(),floor=new THREE.Mesh(new THREE.BoxGeometry(20,.2,20),new THREE.MeshBasicMaterial());
  floor.position.y=-.1;root.add(floor);
  const object=new THREE.Mesh(new THREE.BoxGeometry(.26,.26,.26),new THREE.MeshBasicMaterial());object.position.set(.72,.13,0);root.add(object);
  const host=await attachNativeScene({scene:root,camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},
    autoStart:false,hostProjectId:'native-persist',hostRevision:'v1',walkableMesh:floor});
  host.scene.native.bindComponent({id:'load',object,physics:{body:'dynamic',mass:1,carryable:true,colliders:'mesh-bounds'}});
  return {...host,object};
}
it('restores a saved held native body through content-addressed Overlay into the host-defined object',async()=>{
  const storage=new WorldStorage(new MemoryBlocks()),host=await overlayHost();let fresh;
  try{
    await host.scene.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});settle(host.scene);
    expect((await finish(host.scene,invoke(host.scene,'pickup'))).status).toBe('succeeded');
    const expected=bodyRow(host.world);
    const root=await host.scene.saveOverlay(storage);
    fresh=await overlayHost();const original=fresh.object;
    await fresh.scene.restoreOverlay(storage,root,{active:'saved'});
    expect(fresh.world.interactions.heldByAgent('actor')).toBe('load');
    expect(fresh.world.physics.manipulationBody('load').body).toBe('kinematic');
    vectorClose(fresh.world.physics.getPosition('load'),expected.pose.position);
    expect(fresh.world.physics.entries.get('load').root).toBe(original);
    expect((await finish(fresh.scene,invoke(fresh.scene,'drop'))).status).toBe('succeeded');
  }finally{fresh?.close();host.close();}
});

import * as THREE from 'three';
import {describe,it,expect,vi} from 'vitest';
import {openCodeProject} from '../../application/native-scene/CodeProject.js';
import {attachNativeScene} from '../../application/native-scene/NativeSceneHost.js';

const project={schema:'agentscape.code-project',schemaVersion:1,id:'native_articulation',name:'Native articulation',resources:{},source:"export function createProject({THREE}){\n  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();\n  const make=(size)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());\n  const floor=make([20,.2,20]);floor.position.y=-.1;scene.add(floor);\n  const machine=new THREE.Group();machine.name='NativeMachine';machine.position.set(.9,.85,0);scene.add(machine);\n  const base=make([.4,.4,.4]);base.position.y=-.45;machine.add(base);\n  const hinge=new THREE.Group();hinge.name='Hinge';hinge.position.set(0,0,.22);machine.add(hinge);\n  const panel=make([.42,.38,.08]);panel.position.x=.21;hinge.add(panel);\n  const drawer=make([.36,.2,.36]);drawer.name='Drawer';drawer.position.set(0,0,-.55);machine.add(drawer);\n  const rootPhysics={body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.2,.2],translation:[0,-.45,0]}]};\n  const parts={\n    hinge:{node:'Hinge',physics:{body:'dynamic',mass:.5,colliders:[{shape:'box',halfExtents:[.21,.19,.04],translation:[.21,0,0]}]},\n      joint:{type:'revolute',axis:[0,1,0],limits:[0,.9],motor:{stiffness:120,damping:16}}},\n    drawer:{node:'Drawer',physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.18,.1,.18]}]},\n      joint:{type:'prismatic',axis:[0,0,-1],limits:[0,.6],motor:{stiffness:100,damping:15}}}\n  };\n  return {scene,camera,renderer:{render(){},extensions:{has:()=>false}},walkableMesh:floor,\n    async setup({scene:api}){\n      api.native.bindComponent({id:'machine',object:machine,physics:rootPhysics,parts});\n      if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});\n    }\n  };\n}"};
const open=input=>openCodeProject({project:input||project,authorized:true,autoStart:false});
const row=world=>world.snapshot().nativePhysics.bodies.find(b=>b.id==='machine');
const coordinate=(world,part)=>world.physics.getArticulationState('machine',part).coordinate;
const invoke=(scene,part,name,args)=>scene.interact({action:'invoke',actor:'actor',target:'machine',source:'native-physics',name,partName:part,args});
const receipt=(scene,part,capability)=>scene.verify([{id:'receipt',kind:'interaction-verified',targetId:'machine',partName:part,capability,source:'native-physics'}]).verification.status;
async function finish(scene,job,limit=1800){
  for(let n=0;n<limit&&scene.getJob(job.id).status==='running';n++){
    scene.step();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');return scene.waitJob(job.id);
}
const settle=(scene,n=100)=>{for(let i=0;i<n;i++)scene.step();};

describe('native articulation shares the real joint solver and history',()=>{
  it('moves explicit revolute and prismatic links, verifies part-specific evidence, and rejects an out-of-limit target',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      settle(scene);const original=world.entities.get('machine').object;
      const hinge=original.getObjectByName('Hinge'),drawer=original.getObjectByName('Drawer');
      expect(world.store.has('machine')).toBe(false);
      expect(world.physics.entries.get('machine').parts.get('hinge').node).toBe(hinge);
      expect(world.physics.entries.get('machine').parts.get('drawer').node).toBe(drawer);
      expect(scene.inspect('machine',{actor:'actor'}).capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({name:'rotateJoint',partName:'hinge',source:'native-physics'}),
        expect.objectContaining({name:'slide',partName:'drawer',source:'native-physics'})]));
      const motor=vi.spyOn(world.physics.backend,'setJointTarget');
      const move=await finish(scene,invoke(scene,'hinge','rotateJoint',{target:.55}));
      expect(move,JSON.stringify(move)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,evidenceKind:'joint-motor',historyRecorded:true,partName:'hinge'}}});
      expect(coordinate(world,'hinge')).toBeCloseTo(.55,1);
      expect(motor).toHaveBeenCalled();expect(receipt(scene,'hinge','ROTATEJOINT')).toBe('verified');
      expect(receipt(scene,'drawer','ROTATEJOINT')).toBe('unverified');
      const slide=await finish(scene,invoke(scene,'drawer','slide',{distance:.3}));
      expect(slide,JSON.stringify(slide)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,partName:'drawer'}}});
      expect(coordinate(world,'drawer')).toBeCloseTo(.3,1);
      expect(receipt(scene,'drawer','SLIDE')).toBe('verified');expect(receipt(scene,'hinge','SLIDE')).toBe('unverified');
      const invalid=await finish(scene,invoke(scene,'drawer','slide',{target:1.2}));
      expect(invalid,JSON.stringify(invalid)).toMatchObject({status:'failed',result:{value:{reason:'JOINT_LIMIT_EXCEEDED'}}});
      expect(receipt(scene,'drawer','SLIDE')).toBe('unverified');expect(receipt(scene,'hinge','ROTATEJOINT')).toBe('verified');
      expect(world.entities.get('machine').object).toBe(original);expect(hinge.parent).toBe(original);
      const drawerState=scene.inspect('machine').physics.joints.find(j=>j.partName==='drawer');
      expect(drawerState.type).toBe('prismatic');expect(drawerState.motorTarget).toBeCloseTo(.3,6);
    }finally{host.close();}
  });
  it('restores the original joint zero and motor target through mixed Undo/Redo and a fresh CodeProject',async()=>{
    const host=await open();let fresh;
    try{
      const {scene,world}=host;settle(scene);
      const original=world.entities.get('machine').object,hinge=original.getObjectByName('Hinge'),geometry=hinge.children[0].geometry;
      expect((await finish(scene,invoke(scene,'hinge','rotateJoint',{target:.55}))).status).toBe('succeeded');
      const first=coordinate(world,'hinge');
      const poseOf=snapshot=>snapshot.nativePhysics.bodies.find(b=>b.id==='machine').parts.find(p=>p.name==='hinge').pose;
      const committed=poseOf(world.history.undoStack.at(-1).after);
      const actualPose=()=>world.physics.backend.bodyPose(world.physics.entries.get('machine').parts.get('hinge').body);
      const expectPose=expected=>{
        expect(Math.hypot(...actualPose().position.map((n,i)=>n-expected.position[i]))).toBeLessThan(1e-5);
        expect(Math.hypot(...actualPose().rotation.map((n,i)=>n-expected.rotation[i]))).toBeLessThan(1e-5);
      };
      await scene.addModel({id:'managed',asset:'builtin://cup',position:[-2,1,0]});
      await scene.history({operation:'undo'});
      expect(world.store.has('managed')).toBe(false);
      expect(world.physics.entries.get('machine').parts.get('hinge').node).toBe(hinge);
      expect(coordinate(world,'hinge')).toBeCloseTo(first,4);
      await scene.history({operation:'undo'});
      expect(coordinate(world,'hinge')).toBeCloseTo(0,1);
      expect(receipt(scene,'hinge','ROTATEJOINT')).toBe('unverified');
      await scene.history({operation:'redo'});
      expectPose(committed);
      expect(coordinate(world,'hinge')).toBeCloseTo(.55,1);
      expect(world.physics.entries.get('machine').parts.get('hinge').motorTarget).toBe(.55);
      expect(hinge.children[0].geometry).toBe(geometry);
      await scene.history({operation:'redo'});
      expect(world.store.has('managed')).toBe(true);
      const savedCoordinate=coordinate(world,'hinge');
      const saved=(await host.save()).value;
      expect(saved.runtime.snapshot.nativePhysics.bodies[0].parts).toHaveLength(2);
      fresh=await open(saved);
      expect(fresh.nativeRestore).toEqual({restored:1,skipped:[]});
      expect(coordinate(fresh.world,'hinge')).toBeCloseTo(savedCoordinate,4);
      expect(fresh.world.physics.entries.get('machine').parts.get('hinge').motorTarget).toBe(.55);
      settle(fresh.scene,45);
      const close=await finish(fresh.scene,invoke(fresh.scene,'hinge','rotateJoint',{target:0}));
      expect(close,JSON.stringify(close)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
      expect(coordinate(fresh.world,'hinge')).toBeCloseTo(0,1);
      const reopened=await finish(fresh.scene,invoke(fresh.scene,'hinge','rotateJoint',{angle:.35}));
      expect(reopened,JSON.stringify(reopened)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
      expect(coordinate(fresh.world,'hinge')).toBeCloseTo(.35,1);
    }finally{fresh?.close();host.close();}
  });
  it('rejects invalid persisted joint poses or motor limits before destroying the live solver',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      settle(scene);expect((await finish(scene,invoke(scene,'hinge','rotateJoint',{target:.4}))).status).toBe('succeeded');
      const snapshot=world.snapshot(),original=world.entities.get('machine').object,liveBody=world.physics.entries.get('machine').parts.get('hinge').body;
      const bad=structuredClone(snapshot);bad.nativePhysics.bodies[0].parts.find(p=>p.name==='hinge').pose.position[1]+=2;
      await expect(world.restore(bad)).rejects.toMatchObject({code:'NATIVE_ARTICULATION_SNAPSHOT_POSE_INVALID'});
      expect(world.physics.entries.get('machine').parts.get('hinge').body).toBe(liveBody);
      expect(world.entities.get('machine').object).toBe(original);
      const invalid=structuredClone(snapshot);invalid.nativePhysics.bodies[0].parts.find(p=>p.name==='hinge').motorTarget=2;
      await expect(world.restore(invalid)).rejects.toMatchObject({code:'NATIVE_ARTICULATION_SNAPSHOT_POSE_INVALID'});
      expect(coordinate(world,'hinge')).toBeCloseTo(.4,1);
    }finally{host.close();}
  });
  it('rejects ambiguous link names, wrong parent and noncoincident rest anchors without installing bodies',async()=>{
    const host=await open();const {scene,world}=host;
    try{
      const obj=new THREE.Group();obj.position.set(-4,.8,0);scene.native.scene.add(obj);
      const link=new THREE.Group();link.name='Link';obj.add(link);
      const definition={node:'Link',physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},
        joint:{type:'revolute',axis:[0,1,0],limits:[0,1]}};
      const bind=parts=>scene.native.bindComponent({id:'invalid',object:obj,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},parts});
      expect(()=>bind({a:{...definition,joint:{...definition.joint,parentAnchor:[1,0,0]}}})).toThrow('NATIVE_ARTICULATION_ANCHOR_MISMATCH');
      expect(()=>bind({a:{...definition,parent:'missing'}})).toThrow('NATIVE_ARTICULATION_SERIAL_CHAIN_UNSUPPORTED');
      const duplicate=new THREE.Group();duplicate.name='Link';obj.add(duplicate);
      expect(()=>bind({a:definition})).toThrow('NATIVE_ARTICULATION_LINK_HIERARCHY_INVALID');
      expect(world.physics.entries.has('invalid')).toBe(false);expect(world.entities.has('invalid')).toBe(false);
    }finally{host.close();}
  });
});

it('rejects an unvalidated serial chain instead of advertising coupled joint control',async()=>{
  const host=await open();const {scene,world}=host;
  try{
    const machine=new THREE.Group();machine.position.set(-1.25,.9,0);scene.native.scene.add(machine);
    const arm=new THREE.Group();arm.name='Arm';machine.add(arm);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.16,.14,.16),new THREE.MeshBasicMaterial());
    rail.name='Rail';rail.position.set(.3,0,.35);arm.add(rail);
    const physics=(halfExtents,translation=[0,0,0])=>({body:'dynamic',mass:.3,colliders:[{shape:'box',halfExtents,translation}]});
    expect(()=>scene.native.bindComponent({id:'arm',object:machine,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1],translation:[0,-.5,0]}]},parts:{
      arm:{node:'Arm',physics:physics([.09,.08,.09],[0,0,.35]),joint:{type:'revolute',axis:[0,1,0],limits:[0,.8]}},
      rail:{node:'Rail',parent:'arm',physics:physics([.08,.07,.08]),joint:{type:'prismatic',axis:[1,0,0],limits:[0,.4]}}
    }})).toThrow('NATIVE_ARTICULATION_SERIAL_CHAIN_UNSUPPORTED');
    expect(world.entities.has('arm')).toBe(false);expect(world.physics.entries.has('arm')).toBe(false);
  }finally{host.close();}
});

it('does not verify a slide blocked by an external fixed collider',async()=>{
  const host=await open();const {scene,world}=host;
  try{
    const wall=new THREE.Mesh(new THREE.BoxGeometry(.55,.35,.1),new THREE.MeshBasicMaterial());
    wall.position.set(.9,.85,-1.01);scene.native.scene.add(wall);
    scene.native.bindComponent({id:'blocker',object:wall,physics:{body:'fixed',colliders:'mesh-bounds'}});
    settle(scene);
    const job=await finish(scene,invoke(scene,'drawer','slide',{target:.55}));
    expect(job,JSON.stringify(job)).toMatchObject({status:'failed',result:{value:{verified:false,physicsVerified:false}}});
    expect(coordinate(world,'drawer')).toBeLessThan(.45);
    expect(receipt(scene,'drawer','SLIDE')).toBe('unverified');
  }finally{host.close();}
});

it('rejects a different Three.js node with the same articulated name',async()=>{
  const host=await open();const {scene,world}=host;
  try{
    const machine=world.entities.get('machine').object,hinge=machine.getObjectByName('Hinge'),snapshot=world.snapshot();
    hinge.removeFromParent();const substitute=new THREE.Group();substitute.name='Hinge';machine.add(substitute);
    await expect(world.restore(snapshot)).rejects.toMatchObject({code:'NATIVE_ARTICULATION_LINK_HIERARCHY_INVALID'});
    expect(world.physics.entries.get('machine').parts.get('hinge').node).toBe(hinge);
    substitute.removeFromParent();machine.add(hinge);
    expect(world.snapshot().nativePhysics.bodies[0].parts).toHaveLength(2);
  }finally{host.close();}
});

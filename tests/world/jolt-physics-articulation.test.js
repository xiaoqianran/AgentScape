import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { ArticulationVerifier } from '../../world/verification/ArticulationVerifier.js';
import { createJoltPhysicsSystem } from '../helpers/createJoltPhysicsSystem.js';

const cabinetManifest={
  id:'cabinet',type:'cabinet',source:{kind:'builtin'},actions:['open','close','move'],
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.85,1,.32],translation:[0,1,-.04]}]},
  parts:{door:{
    node:'doorHinge',actions:['open','close'],targets:{open:-1.35,close:0},
    physics:{body:'dynamic',mass:8,colliders:[{shape:'box',halfExtents:[.81,.95,.04],translation:[.81,0,0]}]},
    joint:{type:'revolute',axis:[0,1,0],limits:[-1.35,0],parentAnchor:[-.82,1,.39],childAnchor:[0,0,0],motor:{stiffness:45,damping:9}}
  }}
};

const drawerManifest={
  id:'drawer',type:'drawer',source:{kind:'builtin'},actions:['open','close'],
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]},
  parts:{drawer:{
    node:'Slide',actions:['open','close'],targets:{open:.5,close:0},
    physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.2,.2]}]},
    joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:80,damping:12}}
  }}
};

const fixture=(id,manifest,nodeName,nodePosition=[0,0,0])=>{
  const root=new THREE.Group();
  const node=new THREE.Group(); node.name=nodeName; node.position.set(...nodePosition); root.add(node); root.updateMatrixWorld(true);
  const store=new ObjectStore(); store.add(id,{id,assetId:manifest.id,object:root,manifest,state:{}});
  return {root,node,store};
};

describe('PhysicsSystem Jolt articulation parity',()=>{
  it('drives a revolute cabinet door in the same rest-zero coordinate contract',async()=>{
    const {root,node,store}=fixture('cabinet_01',cabinetManifest,'doorHinge',[-.82,1,.39]);
    const physics=createJoltPhysicsSystem(); await physics.init();
    try {
      physics.attach('cabinet_01',cabinetManifest,root);
      expect(physics.setArticulationTarget('cabinet_01','door',-1)).toBe(true);
      for(let i=0;i<240;i++) physics.step(1/60,store);
      const state=physics.articulationState('cabinet_01','door',{target:-1});
      expect(state).toMatchObject({jointType:'revolute',target:-1,tolerance:.08,coordinateReference:'rest-zero-pose'});
      expect(state.coordinate).toBeLessThan(-.7);
      expect(state.error).toBeLessThan(.2);
      expect(state.localAxis[1]).toBeCloseTo(1,5);
    } finally { physics.dispose(); }
  });

  it('drives a prismatic drawer open and closed with limits and position motor',async()=>{
    const {root,node,store}=fixture('drawer_01',drawerManifest,'Slide');
    const physics=createJoltPhysicsSystem(); await physics.init();
    try {
      physics.attach('drawer_01',drawerManifest,root);
      expect(physics.setArticulationTarget('drawer_01','drawer',.5)).toBe(true);
      for(let i=0;i<240;i++) physics.step(1/60,store);
      let state=physics.articulationState('drawer_01','drawer',{target:.5});
      expect(state.coordinate).toBeGreaterThan(.4);
      expect(state.error).toBeLessThan(.1);
      expect(physics.setArticulationTarget('drawer_01','drawer',.8)).toBe(true);
      for(let i=0;i<240;i++) physics.step(1/60,store);
      state=physics.articulationState('drawer_01','drawer');
      expect(state.coordinate).toBeLessThanOrEqual(.53);

      expect(physics.setArticulationTarget('drawer_01','drawer',0)).toBe(true);
      for(let i=0;i<240;i++) physics.step(1/60,store);
      state=physics.articulationState('drawer_01','drawer',{target:0});
      expect(Math.abs(state.coordinate)).toBeLessThan(.05);
    } finally { physics.dispose(); }
  });

  it('suppresses solver contacts for connected parent-child bodies but keeps penetration diagnostics',async()=>{
    const {root,store}=fixture('drawer_01',drawerManifest,'Slide');
    const physics=createJoltPhysicsSystem(); await physics.init();
    try {
      physics.attach('drawer_01',drawerManifest,root);
      expect(physics.articulationContacts('drawer_01','drawer')).toEqual([]);
      const penetration=physics.articulationPenetrations('drawer_01','drawer',{refresh:true});
      expect(penetration).toHaveLength(1);
      expect(penetration[0].targetPart).toBe('$root');
      physics.setArticulationTarget('drawer_01','drawer',.5);
      for(let i=0;i<240;i++) physics.step(1/60,store);
      expect(physics.articulationState('drawer_01','drawer',{target:.5}).error).toBeLessThan(.1);
    } finally { physics.dispose(); }
  });


  it('runs the existing ArticulationVerifier through the Jolt physicsFactory seam',async()=>{
    const assets={
      getManifest:()=>drawerManifest,
      instantiate:async()=>{
        const root=new THREE.Group();
        const drawer=new THREE.Group(); drawer.name='Slide'; root.add(drawer); root.updateMatrixWorld(true);
        return {object:root,manifest:drawerManifest};
      }
    };
    const report=await new ArticulationVerifier({
      assets,
      steps:240,
      physicsFactory:createJoltPhysicsSystem
    }).verify('drawer');
    expect(report.ok).toBe(true);
    expect(report.tested).toBe(1);
    expect(report.parts[0]).toMatchObject({jointType:'prismatic',reversibility:{checked:true,ok:true}});
    expect(report.parts[0].actions.every((action)=>action.targetReached&&action.finite)).toBe(true);
  });


  it('grows the native joint collision filter without losing existing disabled pairs',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    try {
      const backend=physics.backend;
      const world=physics.world;
      const bodies=[];
      for(let i=0;i<20;i++){
        const body=backend.createBody(world,{type:i===0?'fixed':'dynamic',position:[i*2,0,0]});
        backend.createColliders(world,body,[{shape:'box',halfExtents:[.2,.2,.2]}]);
        bodies.push(body);
      }
      const jointSpec={joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0]}};
      const first=backend.createJoint(world,jointSpec,bodies[0],bodies[1]);
      expect(world.jointFilterCapacity).toBeGreaterThanOrEqual(16);
      const second=backend.createJoint(world,jointSpec,bodies[18],bodies[19]);
      expect(world.jointFilterCapacity).toBeGreaterThanOrEqual(32);
      expect(world.jointFilter.IsCollisionEnabled(first.parentBody.subGroupId,first.childBody.subGroupId)).toBe(false);
      expect(world.jointFilter.IsCollisionEnabled(second.parentBody.subGroupId,second.childBody.subGroupId)).toBe(false);
    } finally { physics.dispose(); }
  });

  it('cleans constraints when articulated bodies are removed',async()=>{
    const {root}=fixture('drawer_01',drawerManifest,'Slide');
    const physics=createJoltPhysicsSystem(); await physics.init();
    try {
      physics.attach('drawer_01',drawerManifest,root);
      expect(physics.world.joints.size).toBe(1);
      physics.remove('drawer_01');
      expect(physics.world.joints.size).toBe(0);
      expect(physics.world.disabledJointPairs.size).toBe(0);
    } finally { physics.dispose(); }
  });
});

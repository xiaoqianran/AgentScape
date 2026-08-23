import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const cabinetObject=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};

describe('Rapier articulated counterfactual geometry',()=>{
  it('compares hypothetical collider trajectories without mutating live bodies',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([{shape:'box',halfExtents:[7,.1,6],translation:[0,-.1,0]}],{id:'floor'});
    const add=(id,position,yaw=0,manifest=assetManifests.cabinet)=>{
      const object=cabinetObject(); object.position.fromArray(position); object.rotation.y=yaw; object.updateMatrixWorld(true);
      store.add(id,{id,assetId:'cabinet',object,manifest:structuredClone(manifest),state:{parts:{door:'close'}}});
      physics.attach(id,store.get(id).manifest,object);
    };
    const blockerManifest=structuredClone(assetManifests.cabinet);
    blockerManifest.parts.door.actions=[...blockerManifest.parts.door.actions,'ajar'];
    blockerManifest.parts.door.targets.ajar=-.8;
    add('cabinet_A',[0,0,0]); add('cabinet_B',[-2.2,0,1],Math.PI/2,blockerManifest);
    for(let i=0;i<30;i++) physics.step(1/60,store);
    expect(physics.setArticulationTarget('cabinet_B','door',-.8)).toBe(true);
    for(let i=0;i<260;i++) physics.step(1/60,store);
    store.get('cabinet_B').state.parts.door='ajar';
    expect(physics.setArticulationTarget('cabinet_A','door',-1.35)).toBe(true);
    for(let i=0;i<180;i++) physics.step(1/60,store);
    physics.holdArticulationCurrent('cabinet_A','door');
    for(let i=0;i<10;i++) physics.step(1/60,store);

    const beforeA=physics.articulationState('cabinet_A','door');
    const beforeB=physics.articulationState('cabinet_B','door');
    const open=physics.articulationPairCounterfactual('cabinet_A','door',-1.35,'cabinet_B','door',-1.35,{samples:17});
    const close=physics.articulationPairCounterfactual('cabinet_A','door',-1.35,'cabinet_B','door',0,{samples:17});
    expect(open).toMatchObject({checked:true,geometry:'rapier-shape-pairs',causal:false,samples:17,targetSweepClear:false});
    expect(close).toMatchObject({checked:true,geometry:'rapier-shape-pairs',causal:false,samples:17,targetSweepClear:true,target:{conflictSamples:0}});
    expect(open.current.conflictSamples).toBeGreaterThan(0);
    expect(close.current.conflictSamples).toBe(open.current.conflictSamples);
    expect(close.conflictReduction).toBeGreaterThan(open.conflictReduction);
    expect(close.action.conflictSamplePairs).toBeGreaterThan(0);
    const afterA=physics.articulationState('cabinet_A','door');
    const afterB=physics.articulationState('cabinet_B','door');
    expect(afterA.coordinate).toBeCloseTo(beforeA.coordinate,8);
    expect(afterB.coordinate).toBeCloseTo(beforeB.coordinate,8);
    physics.dispose();
  });

  it('refuses hypothetical revolute poses when childAnchor requires an unsupported pivot transform',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const manifest=structuredClone(assetManifests.cabinet);
    manifest.parts.door.joint.childAnchor=[.1,0,0];
    const object=cabinetObject(); object.updateMatrixWorld(true);
    store.add('cabinet',{id:'cabinet',assetId:'cabinet',object,manifest,state:{parts:{door:'close'}}});
    physics.attach('cabinet',manifest,object);
    for(let i=0;i<10;i++) physics.step(1/60,store);
    expect(physics.articulationColliderPoses('cabinet','door',-.5)).toMatchObject({
      checked:false,reason:'REVOLUTE_CHILD_ANCHOR_UNSUPPORTED',id:'cabinet',partName:'door',coordinate:-.5
    });
    physics.dispose();
  });

});

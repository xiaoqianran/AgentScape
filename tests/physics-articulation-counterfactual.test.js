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
    expect(open).toMatchObject({checked:true,geometry:'rapier-shape-pairs',causal:false,samples:{original:17,blocker:17,mode:'fixed'},targetSweepClear:false});
    expect(close).toMatchObject({checked:true,geometry:'rapier-shape-pairs',causal:false,samples:{original:17,blocker:17,mode:'fixed'},targetSweepClear:true,target:{conflictSamples:0}});
    expect(open.current.conflictSamples).toBeGreaterThan(0);
    expect(close.current.conflictSamples).toBe(open.current.conflictSamples);
    expect(close.conflictReduction).toBeGreaterThan(open.conflictReduction);
    expect(close.action.conflictSamplePairs).toBeGreaterThan(0);
    const convergence=physics.articulationPairCounterfactualConvergence('cabinet_A','door',-1.35,'cabinet_B','door',0);
    expect(convergence).toMatchObject({
      checked:true,status:'stable',causal:false,
      qualitative:{targetSweepClear:true,clearanceGain:true},
      base:{samples:expect.objectContaining({mode:'adaptive'})},
      dense:{samples:expect.objectContaining({mode:'fixed-pair'})}
    });
    expect(convergence.dense.samples.original).toBeGreaterThan(convergence.base.samples.original);
    expect(convergence.dense.samples.blocker).toBeGreaterThan(convergence.base.samples.blocker);
    expect(convergence.maxRatioDrift).toBeLessThan(.2);
    const afterA=physics.articulationState('cabinet_A','door');
    const afterB=physics.articulationState('cabinet_B','door');
    expect(afterA.coordinate).toBeCloseTo(beforeA.coordinate,8);
    expect(afterB.coordinate).toBeCloseTo(beforeB.coordinate,8);
    physics.dispose();
  });

  it('matches a non-zero childAnchor hypothetical revolute pose against the real Rapier motor result',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const manifest={
      id:'pivot-door',type:'cabinet',source:{kind:'builtin'},actions:['open','close'],
      physics:{body:'fixed',colliders:[]},
      parts:{door:{
        node:'Door',actions:['open','close'],targets:{open:-1,close:0},
        physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.35,.7,.06]}]},
        joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],parentAnchor:[0,1,0],childAnchor:[-1,0,0],motor:{stiffness:60,damping:10}}
      }}
    };
    const root=new THREE.Group();
    const door=new THREE.Group(); door.name='Door'; door.position.set(1,1,0); root.add(door); root.updateMatrixWorld(true);
    store.add('pivot',{id:'pivot',assetId:'pivot-door',object:root,manifest,state:{parts:{door:'close'}}});
    physics.attach('pivot',manifest,root);
    for(let i=0;i<20;i++) physics.step(1/60,store);

    const predicted=physics.articulationColliderPoses('pivot','door',-1);
    expect(predicted).toMatchObject({checked:true,jointType:'revolute',coordinate:-1});
    expect(predicted.colliders).toHaveLength(1);
    const predictedCollider=predicted.colliders[0];

    expect(physics.setArticulationTarget('pivot','door',-1)).toBe(true);
    for(let i=0;i<300;i++) physics.step(1/60,store);
    const state=physics.articulationState('pivot','door',{target:-1});
    expect(state.error).toBeLessThan(.08);
    const body=physics.entries.get('pivot').parts.get('door').body;
    const collider=body.collider(0);
    const actualPosition=collider.translation();
    const actualRotation=collider.rotation();
    const actualQ=new THREE.Quaternion(actualRotation.x,actualRotation.y,actualRotation.z,actualRotation.w).normalize();
    expect(predictedCollider.position.distanceTo(new THREE.Vector3(actualPosition.x,actualPosition.y,actualPosition.z))).toBeLessThan(.035);
    expect(2*Math.acos(Math.min(1,Math.abs(predictedCollider.rotation.dot(actualQ))))).toBeLessThan(.08);

    const pivotAtPrediction=new THREE.Vector3(-1,0,0).applyQuaternion(predictedCollider.rotation).add(predictedCollider.position);
    expect(pivotAtPrediction.distanceTo(new THREE.Vector3(0,1,0))).toBeLessThan(.04);
    physics.dispose();
  });


  it('adapts sample density to joint travel and collider extent while preserving a fixed override',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const manifest={
      id:'adaptive-drawer',type:'drawer',source:{kind:'builtin'},actions:['open','close'],
      physics:{body:'fixed',colliders:[]},
      parts:{drawer:{
        node:'Drawer',actions:['open','close'],targets:{open:.6,close:0},
        physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.08,.08,.08]}]},
        joint:{type:'prismatic',axis:[1,0,0],limits:[0,.6],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:50,damping:9}}
      }}
    };
    const root=new THREE.Group(); const drawer=new THREE.Group(); drawer.name='Drawer'; root.add(drawer); root.updateMatrixWorld(true);
    store.add('drawer',{id:'drawer',assetId:'adaptive-drawer',object:root,manifest,state:{parts:{drawer:'close'}}});
    physics.attach('drawer',manifest,root);
    for(let i=0;i<10;i++) physics.step(1/60,store);
    const short=physics.articulationCounterfactualSampleCount('drawer','drawer',0,.08);
    const long=physics.articulationCounterfactualSampleCount('drawer','drawer',0,.6);
    expect(short).toMatchObject({checked:true,delta:.08,colliders:1});
    expect(long).toMatchObject({checked:true,delta:.6,colliders:1});
    expect(short.count).toBeGreaterThanOrEqual(5);
    expect(long.count).toBeGreaterThan(short.count);
    expect(long.count).toBeLessThanOrEqual(33);
    expect(long.resolution).toBeGreaterThanOrEqual(.02);
    expect(long.resolution).toBeLessThanOrEqual(.08);
    physics.dispose();
  });


  it('predicts and matches a real prismatic blocker moving out of an original prismatic trajectory',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const sliderManifest=(axis,target)=>({
      id:'slider',type:'drawer',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[]},
      parts:{slide:{node:'Slide',actions:['open','close'],targets:{open:target,close:0},physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},joint:{type:'prismatic',axis,limits:[0,target],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:55,damping:9}}}}
    });
    const add=(id,position,manifest)=>{
      const root=new THREE.Group(); root.position.fromArray(position); const slide=new THREE.Group(); slide.name='Slide'; root.add(slide); root.updateMatrixWorld(true);
      store.add(id,{id,assetId:'slider',object:root,manifest,state:{parts:{slide:'close'}}});
      physics.attach(id,manifest,root);
    };
    const originalManifest=sliderManifest([1,0,0],.6);
    const blockerManifest=sliderManifest([0,0,1],.5);
    add('original',[0,0,0],originalManifest);
    add('blocker',[.3,0,0],blockerManifest);
    for(let i=0;i<20;i++) physics.step(1/60,store);

    const beforeOriginal=physics.articulationState('original','slide');
    const beforeBlocker=physics.articulationState('blocker','slide');
    const predictedTarget=physics.articulationColliderPoses('blocker','slide',.5);
    const evidence=physics.articulationPairCounterfactual('original','slide',.6,'blocker','slide',.5);
    expect(evidence).toMatchObject({
      checked:true,geometry:'rapier-shape-pairs',causal:false,
      samples:expect.objectContaining({mode:'adaptive'}),
      targetSweepClear:true,target:{conflictSamples:0}
    });
    expect(evidence.current.conflictSamples).toBeGreaterThan(0);
    expect(evidence.conflictReduction).toBe(evidence.current.conflictSamples);
    expect(evidence.samples.original).toBeGreaterThanOrEqual(5);
    expect(evidence.samples.blocker).toBeGreaterThanOrEqual(5);
    expect(physics.articulationState('original','slide').coordinate).toBeCloseTo(beforeOriginal.coordinate,8);
    expect(physics.articulationState('blocker','slide').coordinate).toBeCloseTo(beforeBlocker.coordinate,8);

    expect(physics.setArticulationTarget('blocker','slide',.5)).toBe(true);
    for(let i=0;i<240;i++) physics.step(1/60,store);
    const blockerState=physics.articulationState('blocker','slide',{target:.5});
    expect(blockerState.error).toBeLessThan(.03);
    const collider=physics.entries.get('blocker').parts.get('slide').body.collider(0);
    const actual=collider.translation();
    expect(predictedTarget.colliders[0].position.distanceTo(new THREE.Vector3(actual.x,actual.y,actual.z))).toBeLessThan(.03);
    physics.dispose();
  });


  it('matches a nested child hypothetical pose after its articulated parent has already moved',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const manifest={
      id:'nested-frame',type:'cabinet',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[]},
      parts:{
        door:{
          node:'Door',actions:['open','close'],targets:{open:-.5,close:0},
          physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.35,.7,.06]}]},
          joint:{type:'revolute',axis:[0,1,0],limits:[-.5,0],parentAnchor:[0,1,0],childAnchor:[-1,0,0],motor:{stiffness:65,damping:11}}
        },
        slider:{
          node:'Slider',parent:'door',actions:['open','close'],targets:{open:.35,close:0},
          physics:{body:'dynamic',mass:.5,colliders:[{shape:'box',halfExtents:[.08,.08,.12]}]},
          joint:{type:'prismatic',axis:[1,0,0],limits:[0,.35],parentAnchor:[.45,0,0],childAnchor:[0,0,0],motor:{stiffness:60,damping:10}}
        }
      }
    };
    const root=new THREE.Group();
    const door=new THREE.Group(); door.name='Door'; door.position.set(1,1,0); root.add(door);
    const slider=new THREE.Group(); slider.name='Slider'; slider.position.set(.45,0,0); door.add(slider);
    root.updateMatrixWorld(true);
    store.add('nested',{id:'nested',assetId:'nested-frame',object:root,manifest,state:{parts:{door:'close',slider:'close'}}});
    physics.attach('nested',manifest,root);
    for(let i=0;i<20;i++) physics.step(1/60,store);
    // Keep the free prismatic child at its verified close coordinate while the parent moves.
    expect(physics.setArticulationTarget('nested','slider',0)).toBe(true);

    expect(physics.setArticulationTarget('nested','door',-.5)).toBe(true);
    for(let i=0;i<300;i++) physics.step(1/60,store);
    const doorState=physics.articulationState('nested','door',{target:-.5});
    expect(doorState.error).toBeLessThan(.08);

    const sliderBefore=physics.articulationState('nested','slider');
    expect(Math.abs(sliderBefore.coordinate)).toBeLessThan(.03);
    const predicted=physics.articulationColliderPoses('nested','slider',.35);
    expect(predicted).toMatchObject({checked:true,jointType:'prismatic',coordinate:.35});
    const parentRotation=new THREE.Quaternion();
    door.getWorldQuaternion(parentRotation);
    const expectedWorldAxis=new THREE.Vector3(1,0,0).applyQuaternion(parentRotation).normalize();
    const currentBody=physics.entries.get('nested').parts.get('slider').body.translation();
    const predictedDelta=predicted.colliders[0].position.clone().sub(new THREE.Vector3(currentBody.x,currentBody.y,currentBody.z));
    expect(Math.abs(predictedDelta.clone().normalize().dot(expectedWorldAxis))).toBeGreaterThan(.98);

    const parentBody=physics.entries.get('nested').parts.get('door').body;
    const parentBeforePosRaw=parentBody.translation(); const parentBeforeRotRaw=parentBody.rotation();
    const parentBeforePos=new THREE.Vector3(parentBeforePosRaw.x,parentBeforePosRaw.y,parentBeforePosRaw.z);
    const parentBeforeRot=new THREE.Quaternion(parentBeforeRotRaw.x,parentBeforeRotRaw.y,parentBeforeRotRaw.z,parentBeforeRotRaw.w).normalize();
    const predictedLocalPosition=predicted.colliders[0].position.clone().sub(parentBeforePos).applyQuaternion(parentBeforeRot.clone().invert());
    const predictedLocalRotation=parentBeforeRot.clone().invert().multiply(predicted.colliders[0].rotation).normalize();

    expect(physics.setArticulationTarget('nested','slider',.35)).toBe(true);
    for(let i=0;i<260;i++) physics.step(1/60,store);
    const sliderState=physics.articulationState('nested','slider',{target:.35});
    expect(sliderState.error).toBeLessThan(.03);
    const collider=physics.entries.get('nested').parts.get('slider').body.collider(0);
    const rawPos=collider.translation(); const rawRot=collider.rotation();
    const actualPosition=new THREE.Vector3(rawPos.x,rawPos.y,rawPos.z);
    const actualRotation=new THREE.Quaternion(rawRot.x,rawRot.y,rawRot.z,rawRot.w).normalize();
    const parentAfterPosRaw=parentBody.translation(); const parentAfterRotRaw=parentBody.rotation();
    const parentAfterPos=new THREE.Vector3(parentAfterPosRaw.x,parentAfterPosRaw.y,parentAfterPosRaw.z);
    const parentAfterRot=new THREE.Quaternion(parentAfterRotRaw.x,parentAfterRotRaw.y,parentAfterRotRaw.z,parentAfterRotRaw.w).normalize();
    const actualLocalPosition=actualPosition.clone().sub(parentAfterPos).applyQuaternion(parentAfterRot.clone().invert());
    const actualLocalRotation=parentAfterRot.clone().invert().multiply(actualRotation).normalize();
    expect(predictedLocalPosition.distanceTo(actualLocalPosition)).toBeLessThan(.035);
    expect(2*Math.acos(Math.min(1,Math.abs(predictedLocalRotation.dot(actualLocalRotation))))).toBeLessThan(.08);
    expect(parentBeforePos.distanceTo(parentAfterPos)).toBeGreaterThan(1e-4);
    physics.dispose();
  });


  it('detects third-object and environment collisions introduced by a hypothetical articulated action without moving the live body',async()=>{
    const physics=new PhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    const manifest={
      id:'world-query-slider',type:'drawer',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[]},
      parts:{slide:{node:'Slide',actions:['open','close'],targets:{open:.6,close:0},physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},joint:{type:'prismatic',axis:[1,0,0],limits:[0,.6],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:55,damping:9}}}}
    };
    const root=new THREE.Group(); const slide=new THREE.Group(); slide.name='Slide'; root.add(slide); root.updateMatrixWorld(true);
    store.add('slider',{id:'slider',assetId:'world-query-slider',object:root,manifest,state:{parts:{slide:'close'}}});
    physics.attach('slider',manifest,root);
    // Original object is deliberately in the sweep but must be excluded by the caller's pairwise owner.
    const original=new THREE.Group(); original.position.set(.25,0,0); original.updateMatrixWorld(true);
    const originalManifest={id:'original',type:'block',source:{kind:'builtin'},actions:[],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.08,.08,.08]}]}};
    store.add('original',{id:'original',assetId:'block',object:original,manifest:originalManifest,state:{}}); physics.attach('original',originalManifest,original);
    const third=new THREE.Group(); third.position.set(.5,0,0); third.updateMatrixWorld(true);
    const thirdManifest={id:'third',type:'block',source:{kind:'builtin'},actions:[],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.08,.08,.08]}]}};
    store.add('third',{id:'third',assetId:'block',object:third,manifest:thirdManifest,state:{}}); physics.attach('third',thirdManifest,third);
    physics.addEnvironment([{shape:'box',halfExtents:[.04,.12,.12],translation:[.62,0,0]}],{id:'test-wall'});
    for(let i=0;i<10;i++) physics.step(1/60,store);

    const before=physics.articulationState('slider','slide');
    const evidence=physics.articulationWorldCounterfactual('slider','slide',.6,{excludeParts:[{objectId:'original',partName:'$root'}],samples:13});
    expect(evidence).toMatchObject({
      checked:true,geometry:'rapier-world-shape-query',causal:false,
      frameAssumption:'other-world-colliders-static-during-hypothesis',
      excludedObjectIds:['slider'],excludedParts:['original:$root'],samples:{count:13,mode:'fixed'},
      targetIntroducesNoCollision:false,actionIntroducesNoCollision:false
    });
    const targetKeys=evidence.targetPose.introducedBlockers.map((item)=>item.key);
    const actionKeys=evidence.actionEnvelope.introducedBlockers.map((item)=>item.key);
    expect(actionKeys.some((key)=>key.startsWith('object:third:'))).toBe(true);
    expect(actionKeys.some((key)=>key.startsWith('environment:test-wall:'))).toBe(true);
    expect(actionKeys.some((key)=>key.startsWith('object:original:'))).toBe(false);
    expect(targetKeys.some((key)=>key.startsWith('environment:test-wall:'))).toBe(true);
    expect(physics.articulationState('slider','slide').coordinate).toBeCloseTo(before.coordinate,8);
    physics.dispose();
  });

});

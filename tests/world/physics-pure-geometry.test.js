import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  projectNavigationObstacle, boxAabbHalfExtents, cylinderAabbHalfExtents, capsuleAabbHalfExtents
} from '../../modules/world/runtime/systems/physics/NavigationObstacleGeometry.js';
import {
  shapeBoundingRadius, estimateArticulationSampleCount, denseCounterfactualSamples,
  summarizeCounterfactualConvergence
} from '../../modules/world/runtime/systems/physics/CounterfactualGeometry.js';

const position = {x:3,y:2,z:-1};
const identity = {x:0,y:0,z:0,w:1};
const tilted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/4);
const yawed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);
const project = (shape,rotation=identity) => projectNavigationObstacle({
  objectId:'crate',partName:'lid',colliderIndex:2,shape,position,rotation
});

describe('stateless navigation obstacle geometry',() => {
  it('keeps exact yaw geometry and identity for upright boxes',() => {
    const halfExtents={x:.4,y:1.2,z:.2};
    expect(project({kind:'box',halfExtents}).item).toEqual({
      id:'crate:lid:2',objectId:'crate',part:'lid',collider:2,
      shape:'box',sourceShape:'box',quality:'exact-yaw',
      position:[3,2,-1],halfExtents:[.4,1.2,.2],angle:0
    });
    const turned=project({kind:'box',halfExtents},yawed).item;
    expect(turned.quality).toBe('exact-yaw');
    expect(turned.angle).toBeCloseTo(Math.PI/4);
    expect(turned.halfExtents).toEqual([.4,1.2,.2]);
  });

  it('conservatively rotates tilted boxes rather than emitting an exact yaw',() => {
    const halfExtents={x:1,y:2,z:3};
    const result=project({kind:'box',halfExtents},tilted).item;
    const expected=3/Math.SQRT2;
    expect(result).toMatchObject({quality:'conservative-aabb',angle:0,sourceShape:'box'});
    expect(result.halfExtents[0]).toBeCloseTo(expected);
    expect(result.halfExtents[1]).toBeCloseTo(expected);
    expect(result.halfExtents[2]).toBeCloseTo(3);
    expect(boxAabbHalfExtents(halfExtents,tilted)).toEqual(result.halfExtents);
  });

  it('preserves the upright and tilted cylinder collision envelopes',() => {
    const shape={kind:'cylinder',radius:.25,halfHeight:.5};
    expect(project(shape).item).toMatchObject({
      sourceShape:'cylinder',shape:'cylinder',quality:'exact-upright',
      position:[3,1.5,-1],radius:.25,height:1
    });
    const inclined=project(shape,tilted).item;
    expect(inclined).toMatchObject({
      sourceShape:'cylinder',shape:'box',quality:'conservative-aabb',angle:0
    });
    expect(inclined.halfExtents).toEqual(cylinderAabbHalfExtents(.25,.5,tilted));
    expect(inclined.halfExtents.every(value=>value>0)).toBe(true);
  });

  it('projects capsule sweep extents without underestimating the cap radius',() => {
    const shape={kind:'capsule',radius:.3,halfHeight:.7};
    expect(project(shape).item).toMatchObject({
      sourceShape:'capsule',shape:'cylinder',quality:'conservative-upright',
      position:[3,1,-1],radius:.3,height:2
    });
    const inclined=project(shape,tilted).item;
    expect(inclined).toMatchObject({shape:'box',sourceShape:'capsule',quality:'conservative-aabb'});
    expect(inclined.halfExtents).toEqual(capsuleAabbHalfExtents(.3,.7,tilted));
    expect(inclined.halfExtents[0]).toBeGreaterThan(.3);
  });

  it('computes finite convex-hull bounds and reports unsupported shapes explicitly',() => {
    const vertices=[-1,-.2,-.5,1,-.2,-.5,1,.2,.5,-1,.2,.5];
    const hull=project({kind:'convexHull',vertices},tilted).item;
    expect(hull).toMatchObject({sourceShape:'convexHull',shape:'box',quality:'conservative-aabb'});
    expect(hull.position.every(Number.isFinite)).toBe(true);
    expect(hull.halfExtents.every(value=>Number.isFinite(value) && value>=0)).toBe(true);
    expect(project({kind:'mesh'})).toEqual({
      skipped:{id:'crate:lid:2',objectId:'crate',part:'lid',collider:2,
        reason:'unsupported-shape',shapeType:'mesh'}
    });
    expect(project({kind:'convexHull',vertices:[]})).toMatchObject({
      skipped:{reason:'unsupported-shape',shapeType:'convexHull'}
    });
  });

  it('leaves the backend snapshot data unchanged',() => {
    const input=Object.freeze({kind:'box',halfExtents:Object.freeze({x:1,y:2,z:3})});
    const result=project(input,tilted);
    expect(result.item.halfExtents).toHaveLength(3);
    expect(input.halfExtents.x).toBe(1);
    expect(position).toEqual({x:3,y:2,z:-1});
  });
});

describe('stateless counterfactual geometry and convergence',() => {
  it('handles known shape extents, convex vertices, endpoints and missing geometry',() => {
    expect(shapeBoundingRadius(null)).toBeNull();
    expect(shapeBoundingRadius({radius:.2})).toBe(.2);
    expect(shapeBoundingRadius({halfExtents:{x:1,y:2,z:2},borderRadius:.1}))
      .toBeCloseTo(Math.hypot(1.1,2.1,2.1));
    expect(shapeBoundingRadius({halfHeight:.5,radius:.2,borderRadius:.1}))
      .toBeCloseTo(Math.hypot(.3,.8));
    expect(shapeBoundingRadius({vertices:[0,0,0,3,4,0]})).toBe(5);
    expect(shapeBoundingRadius({a:{x:1,y:0,z:0},b:{x:0,y:3,z:4}})).toBe(5);
    expect(shapeBoundingRadius({vertices:[0,0,0]})).toBeNull();
  });

  it('preserves zero-travel samples before collider extent queries',() => {
    expect(estimateArticulationSampleCount({
      jointType:'revolute',current:1,target:1,minSamples:7
    })).toEqual({checked:true,count:7,delta:0,maxTravel:0,resolution:.08});
    expect(estimateArticulationSampleCount({
      jointType:'prismatic',current:0,target:.1,covered:0,minRadius:Infinity
    })).toEqual({checked:false,reason:'COLLIDER_EXTENT_UNAVAILABLE'});
  });

  it('scales prismatic and revolute sampling to travel, lever arm and geometric resolution',() => {
    const base={current:0,minRadius:.08,maxLever:.5,covered:1};
    const short=estimateArticulationSampleCount({...base,jointType:'prismatic',target:.08});
    const long=estimateArticulationSampleCount({...base,jointType:'prismatic',target:.6});
    const hinge=estimateArticulationSampleCount({...base,jointType:'revolute',target:1.2});
    expect(short.count).toBeGreaterThanOrEqual(5);
    expect(long.count).toBeGreaterThan(short.count);
    expect(long.count).toBeLessThanOrEqual(33);
    expect(hinge.maxTravel).toBeCloseTo(.6);
    expect(hinge.maxLever).toBe(.5);
    expect(short.maxLever).toBeNull();
    expect(hinge.resolution).toBeGreaterThanOrEqual(.02);
    expect(hinge.resolution).toBeLessThanOrEqual(.08);
  });

  it('uses the existing bounded densification rule even for unusual multipliers',() => {
    expect(denseCounterfactualSamples({original:5,blocker:9}))
      .toEqual({original:10,blocker:18});
    expect(denseCounterfactualSamples({original:32,blocker:33}))
      .toEqual({original:33,blocker:33});
    expect(denseCounterfactualSamples({original:5,blocker:7},.5))
      .toEqual({original:7,blocker:9});
  });

  it('reports stable and unstable counterfactual evidence without mutating inputs',() => {
    const base={
      samples:{original:5,blocker:5},current:{conflictSamples:4},
      target:{conflictSamples:0},action:{conflictSamplePairs:10},
      targetSweepClear:true,conflictReduction:4
    };
    const dense={
      samples:{original:10,blocker:10},current:{conflictSamples:8},
      target:{conflictSamples:0},action:{conflictSamplePairs:40},
      targetSweepClear:true,conflictReduction:8
    };
    const snapshot=structuredClone({base,dense});
    const stable=summarizeCounterfactualConvergence(base,dense);
    expect(stable).toMatchObject({
      checked:true,status:'stable',causal:false,
      qualitative:{targetSweepClear:true,clearanceGain:true},
      ratios:{drift:{current:0,target:0,action:0}},
      maxRatioDrift:0
    });
    expect(summarizeCounterfactualConvergence(base,{...dense,targetSweepClear:false}).status)
      .toBe('unstable');
    expect({base,dense}).toEqual(snapshot);
  });
});

it('conservative navigation AABBs enclose swept primitive samples across multiple 3D orientations',() => {
  const box={kind:'box',halfExtents:{x:.45,y:.9,z:.3}};
  const cylinder={kind:'cylinder',radius:.2,halfHeight:.65};
  const capsule={kind:'capsule',radius:.25,halfHeight:.7};
  const convex={kind:'convexHull',vertices:[-1,-.2,-.5,1,-.2,-.5,1,.2,.5,-1,.2,.5]};
  const corners=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>
    new THREE.Vector3(x*box.halfExtents.x,y*box.halfExtents.y,z*box.halfExtents.z))));
  const cylinderSamples=[-cylinder.halfHeight,cylinder.halfHeight].flatMap(y=>
    Array.from({length:24},(_,index)=>{
      const angle=index*Math.PI/12;
      return new THREE.Vector3(cylinder.radius*Math.cos(angle),y,cylinder.radius*Math.sin(angle));
    }));
  const capsuleSamples=[-capsule.halfHeight,capsule.halfHeight].flatMap(centerY=>
    Array.from({length:16},(_,index)=>Array.from({length:16},(_,polar)=>{
      const azimuth=index*Math.PI/8,theta=polar*Math.PI/15;
      return new THREE.Vector3(
        capsule.radius*Math.sin(theta)*Math.cos(azimuth),
        centerY+capsule.radius*Math.cos(theta),
        capsule.radius*Math.sin(theta)*Math.sin(azimuth)
      );
    })).flat());
  const convexSamples=[];
  for(let i=0;i<convex.vertices.length;i+=3)
    convexSamples.push(new THREE.Vector3(...convex.vertices.slice(i,i+3)));
  for(let step=0;step<12;step++){
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.23+step*.04,.17+step*.03,.39+step*.02));
    for(const [shape,points] of [[box,corners],[cylinder,cylinderSamples],[capsule,capsuleSamples],[convex,convexSamples]]){
      const actual=project(shape,rotation).item;
      expect(actual.shape).toBe('box');
      const center=new THREE.Vector3(...actual.position).sub(new THREE.Vector3(...[position.x,position.y,position.z]));
      for(const point of points){
        const relative=point.clone().applyQuaternion(rotation).sub(center);
        for(let axis=0;axis<3;axis++) expect(Math.abs(relative.getComponent(axis)))
          .toBeLessThanOrEqual(actual.halfExtents[axis]+1e-8);
      }
    }
  }
});

it('keeps manipulation contact geometry working after removing the shared local vector helper',async () => {
  const { createRapierPhysicsSystem } = await import('../helpers/createRapierPhysicsSystem.js');
  const physics=createRapierPhysicsSystem();
  await physics.init();
  try {
    const root=new THREE.Group(); root.updateMatrixWorld(true);
    const manifest={physics:{body:'dynamic',mass:2,colliders:[
      {shape:'box',halfExtents:[.25,.5,.75],translation:[0,.5,0]}
    ]}};
    physics.addObject('crate',manifest,root);
    const body=physics.manipulationBody('crate','$root',{contacts:true});
    expect(body).toMatchObject({
      registered:true,body:'dynamic',colliderCount:1,
      contactCandidates:[{center:expect.any(Array),radius:expect.any(Number)}]
    });
    expect(body.contactCandidates[0].radius).toBeCloseTo(Math.hypot(.25,.5,.75));
    expect(body.contactCandidates[0].center.every(Number.isFinite)).toBe(true);
  } finally {
    physics.dispose();
  }
});

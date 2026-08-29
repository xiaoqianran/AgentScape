import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArticulationVerifier } from '../../world/verification/ArticulationVerifier.js';

function assetsFor(manifest) {
  return {
    getManifest:()=>manifest,
    instantiate:async()=>{
      const root=new THREE.Group();
      const part=new THREE.Group(); part.name=manifest.parts.part.node;
      root.add(part); root.updateMatrixWorld(true);
      return {object:root,manifest};
    }
  };
}

function slider({ target=.5, motor={stiffness:80,damping:12}, rootColliders=[] }={}) {
  return {
    id:'motion_slider',type:'drawer',source:{kind:'builtin'},actions:['open','close'],
    physics:{body:'fixed',colliders:rootColliders},
    parts:{part:{
      node:'Part',actions:['open','close'],targets:{open:target,close:0},
      physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},
      joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor}
    }}
  };
}

describe('ArticulationVerifier motion sweep',()=>{
  it('uses the initial zero-pose penetration as the baseline for the whole open-close trajectory',async()=>{
    const manifest=slider({rootColliders:[{shape:'box',halfExtents:[.5,.5,.5]}]});
    const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:240}).verify(manifest.id);
    expect(report.ok).toBe(true);
    expect(report.parts[0].baselinePenetrations.length).toBeGreaterThan(0);
    expect(report.parts[0].actions.every((action)=>action.targetReached)).toBe(true);
    expect(report.parts[0].actions.every((action)=>action.collisionRegressions.length===0)).toBe(true);
    expect(report.parts[0].reversibility).toMatchObject({checked:true,ok:true,action:'close'});
  });

  it('reports deeper penetration of a collider pair that already overlaps at the zero pose',async()=>{
    const manifest=slider({rootColliders:[{shape:'box',halfExtents:[.4,.2,.2],translation:[.35,0,0]}]});
    const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:240,collisionTolerance:.001}).verify(manifest.id);
    expect(report.ok).toBe(false);
    const baseline=report.parts[0].baselinePenetrations[0];
    const open=report.parts[0].actions.find((action)=>action.action==='open');
    expect(baseline.depth).toBeGreaterThan(0);
    expect(open.collisionRegressions[0].key).toBe(baseline.key);
    expect(open.collisionRegressions[0].depth).toBeGreaterThan(baseline.depth+.01);
    expect(open.failures).toContainEqual(expect.objectContaining({stage:'EXECUTION',code:'COLLISION_REGRESSION'}));
  });

  it('reports a new penetration during motion as an EXECUTION collision regression',async()=>{
    const manifest=slider({rootColliders:[{shape:'box',halfExtents:[.05,.2,.2],translation:[.45,0,0]}]});
    const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:240,collisionTolerance:.001}).verify(manifest.id);
    expect(report.ok).toBe(false);
    const open=report.parts[0].actions.find((action)=>action.action==='open');
    expect(open.targetReached).toBe(true);
    expect(open.failures.some((item)=>item.stage==='EXECUTION' && item.code==='COLLISION_REGRESSION')).toBe(true);
    expect(open.collisionRegressions[0]).toMatchObject({sourcePart:'part',targetPart:'$root'});
    expect(open.collisionRegressions[0].regression).toBeGreaterThan(.01);
  });

  it('distinguishes a stalled motor from a post-condition target miss',async()=>{
    const manifest=slider({motor:{stiffness:0,damping:0}});
    const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:90,stallWindow:20}).verify(manifest.id);
    expect(report.ok).toBe(false);
    const open=report.parts[0].actions.find((action)=>action.action==='open');
    expect(open.stalled).toBe(true);
    expect(open.failures.some((item)=>item.stage==='EXECUTION' && item.code==='STALL')).toBe(true);
    expect(open.failures.some((item)=>item.stage==='POST_CONDITION' && item.code==='TARGET_NOT_REACHED')).toBe(true);
    expect(open.phases.execution.ok).toBe(false);
    expect(open.phases.postCondition.ok).toBe(false);
  });

  it('rejects a target outside the declared joint limits before stepping',async()=>{
    const manifest=slider({target:.8});
    const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:30}).verify(manifest.id);
    const open=report.parts[0].actions.find((action)=>action.action==='open');
    expect(open.stepsRun).toBe(0);
    expect(open.accepted).toBe(false);
    expect(open.failures).toContainEqual(expect.objectContaining({stage:'PRE_CONDITION',code:'TARGET_OUT_OF_LIMITS'}));
  });
});

it('tracks revolute joint coordinates and verifies an open-close return trajectory', async()=>{
  const manifest={
    id:'motion_door',type:'door',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[]},
    parts:{part:{
      node:'Part',actions:['open','close'],targets:{open:-1,close:0},
      physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.5,.05],translation:[.2,0,0]}]},
      joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:60,damping:10}}
    }}
  };
  const report=await new ArticulationVerifier({assets:assetsFor(manifest),steps:240}).verify(manifest.id);
  expect(report.ok).toBe(true);
  const open=report.parts[0].actions.find((action)=>action.action==='open');
  expect(open.finalCoordinate).toBeCloseTo(-1,1);
  expect(open.targetReached).toBe(true);
  expect(report.parts[0].reversibility.ok).toBe(true);
});

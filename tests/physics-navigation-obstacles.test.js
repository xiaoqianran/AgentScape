import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

const cabinetManifest={
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.85,1,.32],translation:[0,1,0]}]},
  parts:{door:{
    node:'Door', physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.8,.95,.04],translation:[.8,0,0]}]},
    joint:{type:'revolute',axis:[0,1,0],limits:[-1.2,0],parentAnchor:[0,1,0],childAnchor:[0,0,0],motor:{stiffness:60,damping:10}}
  }}
};

describe('PhysicsSystem navigation obstacle snapshots',()=>{
  it('reports dynamic roots and articulated Parts from current Rapier collider poses',async()=>{
    const physics=createRapierPhysicsSystem(); await physics.init();
    const root=new THREE.Group(); const door=new THREE.Group(); door.name='Door'; root.add(door); root.updateMatrixWorld(true);
    const store=new ObjectStore(); store.add('cab',{id:'cab',assetId:'cab',object:root,manifest:cabinetManifest,state:{}});
    physics.attach('cab',cabinetManifest,root);

    const before=physics.navigationObstacles();
    expect(before.skipped).toEqual([]);
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({id:'cab:door:0',part:'door',shape:'box',sourceShape:'box',quality:'exact-yaw'});
    const beforePosition=[...before.items[0].position];
    expect(physics.setArticulationTarget('cab','door',-1.2)).toBe(true);
    for(let i=0;i<240;i++) physics.step(1/60,store);
    const opened=physics.navigationObstacles().items[0];
    expect(Math.hypot(opened.position[0]-beforePosition[0],opened.position[2]-beforePosition[2])).toBeGreaterThan(.2);
    expect(Math.abs(opened.angle)).toBeGreaterThan(.5);
    physics.dispose();
  });

  it('uses conservative collider-derived AABBs for tilted cylinders and convex hulls',async()=>{
    const physics=createRapierPhysicsSystem(); await physics.init();
    const root=new THREE.Group(); root.rotation.z=Math.PI/4; root.updateMatrixWorld(true);
    const manifest={physics:{body:'dynamic',colliders:[{shape:'cylinder',halfHeight:.5,radius:.2},{shape:'convexHull',vertices:[-1,-.1,-.1,1,-.1,-.1,0,.1,.1,0,.1,-.1]}]}};
    physics.attach('x',manifest,root);
    const snapshot=physics.navigationObstacles();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toMatchObject({sourceShape:'cylinder',shape:'box',quality:'conservative-aabb'});
    expect(snapshot.items[1]).toMatchObject({sourceShape:'convexHull',shape:'box',quality:'conservative-aabb'});
    expect(snapshot.items.every((item)=>item.halfExtents.every((value)=>Number.isFinite(value)&&value>0))).toBe(true);
    physics.dispose();
  });
});

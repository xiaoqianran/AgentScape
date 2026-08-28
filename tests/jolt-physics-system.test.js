import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { JoltPhysicsBackend } from '../src/runtime/physics/JoltPhysicsBackend.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

describe('PhysicsSystem + JoltPhysicsBackend',()=>{
  it('attaches semantic manifests, simulates, syncs pose and serves scene queries',async()=>{
    const physics=new PhysicsSystem({backend:new JoltPhysicsBackend()});
    await physics.init();
    const store=new Map();
    try {
      const floorObject=new THREE.Group();
      floorObject.position.set(0,-.5,0); floorObject.updateMatrixWorld(true);
      store.set('floor',{object:floorObject});
      physics.attach('floor',{physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[4,.5,4]}]}},floorObject);

      const boxObject=new THREE.Group();
      boxObject.position.set(0,3,0); boxObject.updateMatrixWorld(true);
      store.set('box',{object:boxObject});
      physics.attach('box',{physics:{body:'dynamic',mass:2,friction:.5,colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]}},boxObject);

      for(let i=0;i<240;i++) physics.step(1/60,store);
      expect(boxObject.position.y).toBeGreaterThan(.45);
      expect(boxObject.position.y).toBeLessThan(.56);

      const hit=physics.raycast([0,5,0],[0,-1,0],10);
      expect(hit).toMatchObject({id:'box',part:'$root'});

      const obstacles=physics.navigationObstacles();
      expect(obstacles.items.some((item)=>item.objectId==='box'&&item.sourceShape==='box')).toBe(true);
      expect(physics.profile()).toMatchObject({
        identity:'jolt',
        backendCapabilities:['rigid-body','collision','scene-query'],
        runtimeCapabilities:expect.arrayContaining(['transform-state','articulation-pose','counterfactual-query'])
      });
    } finally { physics.dispose(); }
  });
});

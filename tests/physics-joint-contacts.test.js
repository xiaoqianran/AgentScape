import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';

it('disables parent-child contacts so a prismatic joint can open and close through overlapping colliders', async () => {
  const manifest = {
    id:'drawer', type:'drawer', source:{kind:'builtin'}, actions:['open','close'],
    physics:{ body:'fixed', colliders:[{shape:'box',halfExtents:[.5,.5,.5]}] },
    parts:{
      drawer:{
        node:'Drawer', actions:['open','close'], targets:{open:.5,close:0},
        physics:{ body:'dynamic', mass:1, colliders:[{shape:'box',halfExtents:[.2,.2,.2]}] },
        joint:{ type:'prismatic', axis:[1,0,0], limits:[0,.5], parentAnchor:[0,0,0], childAnchor:[0,0,0], motor:{stiffness:80,damping:12} }
      }
    }
  };
  const root = new THREE.Group();
  const node = new THREE.Group();
  node.name = 'Drawer';
  root.add(node);
  root.updateMatrixWorld(true);
  const store = new ObjectStore();
  store.add('d',{id:'d',assetId:'drawer',object:root,manifest,state:{}});
  const physics = createRapierPhysicsSystem();
  await physics.init();
  physics.attach('d',manifest,root);
  const joint = physics.entries.get('d').parts.get('drawer').joint;
  expect(joint.contactsEnabled()).toBe(false);
  physics.setArticulationTarget('d','drawer',.5);
  for(let i=0;i<240;i++) physics.step(1/60,store);
  expect(node.position.x).toBeGreaterThan(.45);
  physics.setArticulationTarget('d','drawer',0);
  for(let i=0;i<240;i++) physics.step(1/60,store);
  expect(Math.abs(node.position.x)).toBeLessThan(.03);
  physics.dispose();
});

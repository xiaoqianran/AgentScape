import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { InteractionSystem } from '../../world/runtime/systems/InteractionSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

it('closes the loop from a real Rapier door recommendation to current-world replanning after opening',async()=>{
  const store=new ObjectStore();
  const physics=createRapierPhysicsSystem(); await physics.init();
  const events=new EventBus();
  const root=new THREE.Group();
  const door=new THREE.Group(); door.name='Door'; root.add(door); root.updateMatrixWorld(true);
  const manifest={
    id:'gate',type:'door',source:{kind:'builtin'},actions:['open','close'],physics:{body:'fixed',colliders:[]},
    parts:{door:{
      node:'Door',actions:['open','close'],targets:{open:-Math.PI/2,close:0},
      physics:{body:'dynamic',mass:4,colliders:[{shape:'box',halfExtents:[.1,1,4],translation:[0,1,0]}]},
      joint:{type:'revolute',axis:[0,1,0],limits:[-Math.PI/2,0],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:70,damping:12}}
    }}
  };
  store.add('gate',{id:'gate',assetId:'gate',object:root,manifest,state:{parts:{door:'close'}}});
  physics.attach('gate',manifest,root);

  const floor=new THREE.Mesh(new THREE.BoxGeometry(10,.2,8)); floor.position.y=-.1; floor.updateMatrixWorld(true);
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[floor],events});
  const interactions=new InteractionSystem({store,physics,spatial:{},events});

  const suggestion=await navigation.suggestActions([-4,0,0],[4,0,0]);
  expect(suggestion.status).toBe('action-candidate');
  expect(suggestion.recommendation.call).toEqual({name:'open',args:{id:'gate',partName:'door'}});
  expect((await navigation.findPath([-4,0,0],[4,0,0])).reachable).toBe(false);

  interactions.setArticulationAction('gate','open',{partName:'door'});
  const whileMoving=await navigation.suggestActions([-4,0,0],[4,0,0]);
  expect(['waiting-for-world-update','reachable']).toContain(whileMoving.status);
  for(let i=0;i<240;i++) physics.step(1/60,store);

  const replanned=await navigation.findPath([-4,0,0],[4,0,0]);
  expect(replanned.reachable).toBe(true);
  expect(replanned.scope).toBe('current');
  expect(replanned.path.length).toBeGreaterThan(2);
  expect(navigation.status().buildVersion).toBe(1);

  navigation.dispose(); physics.dispose(); floor.geometry.dispose();
},15000);

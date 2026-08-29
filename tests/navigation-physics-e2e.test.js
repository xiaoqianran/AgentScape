import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';

it('derives current-world reachability from live Rapier dynamic colliders without rebuilding static Recast geometry',async()=>{
  const store=new ObjectStore();
  const physics=createRapierPhysicsSystem(); await physics.init();
  const barrier=new THREE.Group(); barrier.position.set(0,1,0); barrier.updateMatrixWorld(true);
  const manifest={physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.25,1,4]}]}};
  store.add('barrier',{id:'barrier',assetId:'barrier',object:barrier,manifest,state:{}});
  physics.attach('barrier',manifest,barrier);

  const floor=new THREE.Mesh(new THREE.BoxGeometry(10,.2,8)); floor.position.y=-.1; floor.updateMatrixWorld(true);
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[floor]});

  const blocked=await navigation.findPath([-4,0,0],[4,0,0]);
  expect(blocked).toMatchObject({reachable:false,scope:'current',reason:'PARTIAL_PATH',buildVersion:1});
  expect(blocked.dynamicObstacles).toMatchObject({coverage:'complete',tracked:1,changed:1});

  physics.setPosition('barrier',[0,1,20]);
  const clear=await navigation.findPath([-4,0,0],[4,0,0]);
  expect(clear).toMatchObject({reachable:true,scope:'current',buildVersion:1});
  expect(clear.dynamicObstacles).toMatchObject({tracked:1,changed:1,operations:2});
  expect(navigation.status().buildVersion).toBe(1);

  navigation.dispose(); physics.dispose(); floor.geometry.dispose();
},15000);

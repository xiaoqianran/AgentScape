import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../world/runtime/systems/LocomotionSystem.js';
import { assetManifests } from '../asset/manifests/index.js';
import { createRuinedCourtyard } from '../world/content/ruinedCourtyard.js';
import { disposeObject3D } from '../core/disposeObject3D.js';

it('walks a real kinematic Agent Body up the Ruined Courtyard stairs to the 1.2m east terrace',async()=>{
  const world=createRuinedCourtyard({loadAssets:false});
  const store=new ObjectStore();
  const physics=createRapierPhysicsSystem(); await physics.init();
  physics.addEnvironment(world.colliders);
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[world.root]});
  // Prebuild navigation before starting the real-time locomotion task.
  expect((await navigation.findPath([0,0,12],[12,1.2,4.8])).reachable).toBe(true);

  const object=new THREE.Group(); object.position.set(0,0,12); object.updateMatrixWorld(true);
  const manifest=structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object,manifest,state:{}});
  physics.attach('agent_01',manifest,object);
  physics.step(1/60,store);

  const locomotion=new LocomotionSystem({store,physics,navigation});
  let result=null;
  const completion=locomotion.navigate('agent_01',[12,1.2,4.8],{speed:3,timeout:20}).then((value)=>{result=value;});
  for(let i=0;i<10 && !locomotion.tasks.has('agent_01');i++) await new Promise((resolve)=>setTimeout(resolve,0));
  expect(locomotion.tasks.has('agent_01')).toBe(true);

  for(let i=0;i<1200 && !result;i++){
    locomotion.update(1/60);
    physics.step(1/60,store);
  }
  await completion;

  expect(result.status).toBe('arrived');
  expect(result.position[0]).toBeGreaterThan(11.7);
  expect(result.position[1]).toBeGreaterThan(1.0);
  expect(result.position[2]).toBeGreaterThan(4.4);
  expect(store.get('agent_01').state.navigation.status).toBe('arrived');
  expect(navigation.status().buildVersion).toBe(1);

  locomotion.cancelAll(); navigation.dispose(); physics.dispose(); world.dispose(); disposeObject3D(object);
},20000);

import * as THREE from 'three';
import { expect,it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../world/runtime/systems/LocomotionSystem.js';
import { assetManifests } from '../asset/manifests/index.js';
import { createJoltPhysicsSystem } from './helpers/createJoltPhysicsSystem.js';

it('returns PHYSICS_BLOCKED when Jolt sees a wall omitted from the planned NavMesh',async()=>{
  const floor=new THREE.Mesh(new THREE.BoxGeometry(8,.2,6)); floor.position.y=-.1; floor.updateMatrixWorld(true);
  const store=new ObjectStore();
  const physics=createJoltPhysicsSystem(); await physics.init();
  physics.addEnvironment([
    {shape:'box',halfExtents:[4,.1,3],translation:[0,-.1,0]},
    {shape:'box',halfExtents:[.1,1.5,2.8],translation:[0,1.5,0]}
  ]);
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[floor]});
  expect((await navigation.findPath([-3,0,0],[3,0,0])).reachable).toBe(true);

  const object=new THREE.Group(); object.position.set(-3,0,0); object.updateMatrixWorld(true);
  const manifest=structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object,manifest,state:{}});
  physics.attach('agent_01',manifest,object); physics.step(1/60,store);
  const locomotion=new LocomotionSystem({store,physics,navigation});

  let result=null;
  const completion=locomotion.navigate('agent_01',[3,0,0],{speed:2.5,timeout:10}).then((value)=>{result=value;});
  for(let i=0;i<10&&!locomotion.tasks.has('agent_01');i++) await new Promise((resolve)=>setTimeout(resolve,0));
  for(let i=0;i<600&&!result;i++){
    locomotion.update(1/60);
    physics.step(1/60,store);
  }
  await completion;

  expect(result).toMatchObject({status:'blocked',reason:'PHYSICS_BLOCKED'});
  expect(result.position[0]).toBeLessThan(-.38);
  expect(store.get('agent_01').state.navigation.status).toBe('blocked');
  expect(navigation.status().buildVersion).toBe(1);

  locomotion.cancelAll(); navigation.dispose(); physics.dispose(); floor.geometry.dispose();
},15000);

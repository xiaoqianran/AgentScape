import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { validateAssetManifest } from '../src/assets/schema.js';

const agentManifest={
  id:'agent-test',type:'agent',source:{kind:'builtin'},actions:['navigate'],
  physics:{body:'kinematic',navigationObstacle:false,colliders:[{shape:'capsule',halfHeight:.53,radius:.32,translation:[0,.85,0]}]}
};

describe('Rapier character controller integration',()=>{
  it('accepts capsule + navigationObstacle manifest contract',()=>{
    expect(()=>validateAssetManifest(agentManifest)).not.toThrow();
    expect(()=>validateAssetManifest({...agentManifest,physics:{...agentManifest.physics,navigationObstacle:'no'}})).toThrow(/navigationObstacle/i);
  });

  it('stops a kinematic capsule at a fixed wall instead of tunneling through it',async()=>{
    const physics=createRapierPhysicsSystem(); await physics.init();
    physics.addEnvironment([
      {shape:'box',halfExtents:[4,.1,3],translation:[0,-.1,0]},
      {shape:'box',halfExtents:[.1,1.5,2.5],translation:[0,1.5,0]}
    ]);
    const object=new THREE.Group(); object.position.set(-2,0,0); object.updateMatrixWorld(true);
    const store=new ObjectStore(); store.add('agent',{id:'agent',assetId:'agent',object,manifest:agentManifest,state:{}});
    physics.attach('agent',agentManifest,object);
    for(let i=0;i<180;i++){
      const result=physics.moveCharacter('agent',[.035,-.01,0]);
      expect(result.success).toBe(true);
      physics.step(1/60,store);
    }
    expect(object.position.x).toBeLessThan(-.38);
    expect(object.position.x).toBeGreaterThan(-.8);
    expect(object.position.y).toBeGreaterThan(-.02);
    expect(physics.navigationObstacles().items.find((item)=>item.objectId==='agent')).toBeUndefined();
    physics.dispose();
  });
});

it('turns the symmetric kinematic capsule toward the walking direction', async () => {
  const physics=createRapierPhysicsSystem(); await physics.init();
  physics.addEnvironment([{shape:'box',halfExtents:[2,.1,2],translation:[0,-.1,0]}]);
  const object=new THREE.Group(); object.updateMatrixWorld(true);
  const store=new ObjectStore(); store.add('agent',{id:'agent',assetId:'agent',object,manifest:agentManifest,state:{}});
  physics.attach('agent',agentManifest,object);
  expect(physics.faceCharacter('agent',[1,0,0])).toBe(true);
  physics.step(1/60,store);
  expect(Math.abs(object.quaternion.y)).toBeGreaterThan(.6);
  physics.dispose();
});

it('sets an explicit kinematic character yaw in both Rapier and the Three root', async () => {
  const physics=createRapierPhysicsSystem(); await physics.init();
  const object=new THREE.Group(); object.updateMatrixWorld(true);
  const store=new ObjectStore(); store.add('agent',{id:'agent',assetId:'agent',object,manifest:agentManifest,state:{}});
  physics.attach('agent',agentManifest,object);
  expect(physics.setCharacterYaw('agent',Math.PI/2)).toBe(true);
  const body=physics.entries.get('agent').body;
  const q=body.rotation();
  expect(Math.abs(q.y)).toBeCloseTo(Math.SQRT1_2,5);
  expect(Math.abs(object.quaternion.y)).toBeCloseTo(Math.SQRT1_2,5);
  expect(physics.setCharacterYaw('missing',0)).toBe(false);
  physics.dispose();
});
